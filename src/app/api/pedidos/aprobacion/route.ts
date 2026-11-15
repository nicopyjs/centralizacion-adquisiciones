import { NextResponse } from "next/server";
import {
  RECHAZADO,
  avisarAprobacion,
  type LineaAprobada,
  estadoAprobacion,
  norm,
  type EstadoAprobacion,
} from "@/lib/aprobacion";
import { areaLabel, getSesion } from "@/lib/auth";
import { agregarMensaje, normArea } from "@/lib/chat";
import {
  articulosSheetId,
  batchWriteRanges,
  getSpreadsheetMeta,
  readRange,
} from "@/lib/google-sheets";
import { getGoogleEmail } from "@/lib/google-oauth";
import { perfilDeEmail } from "@/lib/usuarios";

const PEDIDOS_SHEET = "Pedidos";
const MOTIVO_QUITADO = "Quitado por el supervisor al aprobar";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

function error(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export type ItemAprobacion = {
  fila: number;
  codigo: string;
  nombre: string;
  unidad: string;
  cantidad: number;
  comentarioArticulo: string;
};

export type PedidoPorAprobar = {
  pedidoId: string;
  fecha: string;
  solicitante: string;
  area: string;
  centroNegocio: string;
  fechaEntrega: string;
  despacho: string;
  comentario: string;
  urgente: boolean;
  estado: EstadoAprobacion;
  motivoRechazo: string;
  items: ItemAprobacion[];
};

/**
 * Áreas (normalizadas) cuyos pedidos puede aprobar quien tiene sesión: las de
 * su cuenta @nebchile.cl. Si la sesión trabaja en un área concreta, solo esa
 * se muestra en el listado; para aprobar basta con que el área sea suya.
 */
async function permisos() {
  const email = await getGoogleEmail();
  const usuario = perfilDeEmail(email);
  if (!email || !usuario) return null;
  const propias = new Set(usuario.areas.map((a) => norm(areaLabel(a))));
  const sesion = await getSesion();
  const enVista =
    sesion?.area && propias.has(norm(areaLabel(sesion.area)))
      ? new Set([norm(areaLabel(sesion.area))])
      : propias;
  return { email, propias, enVista };
}

async function leerPendientes(areas: Set<string>): Promise<PedidoPorAprobar[]> {
  const sheetId = articulosSheetId();
  const meta = await getSpreadsheetMeta(sheetId);
  if (!meta.sheets.some((s) => s.properties.title === PEDIDOS_SHEET)) return [];
  const rows = await readRange(sheetId, `${PEDIDOS_SHEET}!A2:Z`);
  const porPedido = new Map<string, PedidoPorAprobar>();
  rows.forEach((row, i) => {
    const pedidoId = str(row[0]);
    const estado = estadoAprobacion(str(row[23]));
    if (!pedidoId || !estado || !areas.has(norm(str(row[3])))) return;
    let p = porPedido.get(pedidoId);
    if (!p) {
      p = {
        pedidoId,
        fecha: str(row[1]),
        solicitante: str(row[2]),
        area: str(row[3]),
        centroNegocio: str(row[4]),
        fechaEntrega: str(row[6]),
        despacho: str(row[9]),
        comentario: str(row[15]),
        urgente: ["si", "sí", "s", "1", "true", "urgente"].includes(
          str(row[19]).toLowerCase()
        ),
        estado,
        motivoRechazo: str(row[24]),
        items: [],
      };
      porPedido.set(pedidoId, p);
    }
    p.items.push({
      fila: i + 2,
      codigo: str(row[11]),
      nombre: str(row[12]),
      unidad: str(row[13]),
      cantidad: Number(row[14]) || 0,
      comentarioArticulo: str(row[22]),
    });
  });
  return Array.from(porPedido.values()).sort((a, b) =>
    b.fecha.localeCompare(a.fecha)
  );
}

/** Lista los pedidos por aprobar / rechazados de las áreas del supervisor. */
export async function GET(request: Request) {
  const perm = await permisos();
  if (!perm) return error("No autorizado.", 401);
  try {
    const pedidos = await leerPendientes(perm.enVista);
    if (new URL(request.url).searchParams.get("contar")) {
      return NextResponse.json({
        pendientes: pedidos.filter((p) => p.estado === "pendiente").length,
      });
    }
    return NextResponse.json({ pedidos });
  } catch (err) {
    return error(err instanceof Error ? err.message : "Error desconocido", 500);
  }
}

type LineaEdicion = { fila?: unknown; cantidad?: unknown; quitar?: unknown };

/**
 * Body: `{ accion: "aprobar" | "rechazar", pedidoId, motivo?, lineas? }`.
 *  - aprobar: aplica antes las ediciones de `lineas` (`{fila, cantidad, quitar}`)
 *    y deja el pedido visible para Adquisiciones.
 *  - rechazar: exige `motivo`; queda en «Rechazado» (se puede aprobar después).
 */
export async function POST(request: Request) {
  const perm = await permisos();
  if (!perm) return error("No autorizado.", 401);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return error("JSON inválido");
  }
  const accion = str(body.accion);
  const pedidoId = str(body.pedidoId);
  const motivo = str(body.motivo);
  if (accion !== "aprobar" && accion !== "rechazar") return error("Acción inválida.");
  if (!pedidoId) return error("Falta el pedido.");
  if (accion === "rechazar" && !motivo) {
    return error("Para rechazar indica el motivo: el maestro lo necesita para corregirlo.");
  }

  const sheetId = articulosSheetId();
  try {
    const rows = await readRange(sheetId, `${PEDIDOS_SHEET}!A2:Z`);
    const lineasPedido = rows
      .map((r, i) => ({ r, fila: i + 2 }))
      .filter((x) => str(x.r[0]) === pedidoId);
    if (lineasPedido.length === 0) return error("El pedido ya no existe.", 404);
    const area = str(lineasPedido[0].r[3]);
    if (!perm.propias.has(norm(area))) {
      return error("Ese pedido es de un área que no supervisas.", 403);
    }
    if (!estadoAprobacion(str(lineasPedido[0].r[23]))) {
      return error("Ese pedido ya no está pendiente de aprobación. Recarga la lista.", 409);
    }

    const data: { range: string; values: (string | number)[][] }[] = [];
    const cambios: string[] = [];
    // Artículos que quedan aprobados (con las cantidades ya ajustadas).
    const lineasFinales: LineaAprobada[] = [];

    if (accion === "aprobar") {
      const ediciones = new Map<number, { cantidad: number; quitar: boolean }>();
      for (const l of Array.isArray(body.lineas) ? (body.lineas as LineaEdicion[]) : []) {
        const fila = Number(l.fila);
        const cantidad = Number(l.cantidad);
        if (!lineasPedido.some((x) => x.fila === fila)) {
          return error("El pedido cambió. Recarga la lista e inténtalo de nuevo.", 409);
        }
        if (l.quitar !== true && (!Number.isFinite(cantidad) || cantidad <= 0)) {
          return error("Las cantidades deben ser mayores que cero.");
        }
        ediciones.set(fila, { cantidad, quitar: l.quitar === true });
      }
      const quedan = lineasPedido.filter((x) => !ediciones.get(x.fila)?.quitar);
      if (quedan.length === 0) {
        return error("No puedes quitar todos los artículos: si no corresponde, rechaza el pedido.");
      }
      for (const x of lineasPedido) {
        const e = ediciones.get(x.fila);
        if (!e) continue;
        const nombre = `${str(x.r[11])} ${str(x.r[12])}`.trim();
        if (e.quitar) {
          data.push({ range: `${PEDIDOS_SHEET}!Z${x.fila}`, values: [[MOTIVO_QUITADO]] });
          cambios.push(`se quitó ${nombre}`);
        } else if (e.cantidad !== (Number(x.r[14]) || 0)) {
          data.push({ range: `${PEDIDOS_SHEET}!O${x.fila}`, values: [[e.cantidad]] });
          cambios.push(`${nombre}: ${Number(x.r[14]) || 0} → ${e.cantidad}`);
        }
      }
      for (const x of quedan) {
        const e = ediciones.get(x.fila);
        lineasFinales.push({
          nombre: str(x.r[12]),
          cantidad: e && !e.quitar ? e.cantidad : Number(x.r[14]) || 0,
          unidad: str(x.r[13]),
          comentario: str(x.r[22]),
        });
      }
    }

    for (const x of lineasPedido) {
      data.push({
        range: `${PEDIDOS_SHEET}!X${x.fila}:Y${x.fila}`,
        values: [accion === "aprobar" ? ["", ""] : [RECHAZADO, motivo]],
      });
    }
    await batchWriteRanges(sheetId, data);

    if (accion === "aprobar") {
      // Queda constancia en el chat del pedido (y Adquisiciones ve que llegó).
      try {
        await agregarMensaje(pedidoId, normArea(area), {
          id: crypto.randomUUID(),
          rol: "solicitante",
          autor: perm.email,
          texto:
            `✅ Pedido aprobado por ${perm.email}` +
            (cambios.length ? ` con cambios: ${cambios.join("; ")}.` : "."),
          ts: Date.now(),
          adjuntos: [],
        });
      } catch {
        // Secundario: si Redis falla, la aprobación en la planilla igual vale.
      }
    }

    // Aviso a Adquisiciones (con el área en copia): ya no hay otro correo del pedido.
    let correoEnviado = false;
    if (accion === "aprobar") {
      const cab = lineasPedido[0].r;
      correoEnviado = await avisarAprobacion({
        pedidoId,
        area,
        centro: str(cab[4]),
        solicitante: str(cab[2]),
        aprobador: perm.email,
        clasificador1: str(cab[7]),
        clasificador2: str(cab[8]),
        despacho: str(cab[9]),
        fechaEntrega: str(cab[6]),
        comentario: str(cab[15]),
        urgente: ["si", "sí", "s", "1", "true", "urgente"].includes(str(cab[19]).toLowerCase()),
        lineas: lineasFinales,
        cambios,
        origen: new URL(request.url).origin,
      });
    }

    return NextResponse.json({
      ok: true,
      estado: accion === "aprobar" ? "aprobado" : "rechazado",
      correoEnviado,
    });
  } catch (err) {
    return error(err instanceof Error ? err.message : "Error desconocido", 500);
  }
}
