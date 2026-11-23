import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import { agregarMensaje, renombrarHilo, normArea } from "@/lib/chat";
import { AREAS } from "@/lib/auth";
import { renombrarCarpetaPedido } from "@/lib/drive";
import { ETIQUETAS_SHEET } from "@/lib/etiquetas";
import { CLASIFICADORES_1, CLASIFICADORES_2 } from "@/lib/clasificadores";
import { fechaEntregaAYMD } from "@/lib/fechas";
import {
  appendRows,
  articulosSheetId,
  batchWriteRanges,
  readRange,
} from "@/lib/google-sheets";

const PEDIDOS_SHEET = "Pedidos";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

function fechaValida(s: string): boolean {
  return s === "" || /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function error(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

/** Deja constancia en el chat del pedido para que el solicitante vea el cambio. */
async function avisarEnChat(folio: string, area: string, texto: string) {
  try {
    await agregarMensaje(folio, normArea(area), {
      id: crypto.randomUUID(),
      rol: "adquisiciones",
      autor: "Adquisiciones",
      texto: `✏️ Pedido modificado: ${texto}`,
      ts: Date.now(),
      adjuntos: [],
    });
  } catch {
    // El aviso es secundario: si Redis falla, el cambio en la planilla igual vale.
  }
}

// Prefijo del código de centro de cada área (igual que en Enviar Pedido).
const PREFIJO_AREA: Record<string, string> = {
  refacciones: "RCT",
  "servicio técnico": "SST",
  instalaciones: "INT",
  "transición y postventa": "TYP",
};

/** Siguiente folio correlativo del prefijo (RCT-1, RCT-2, …). */
async function siguienteFolio(sheetId: string, prefijo: string): Promise<string> {
  const col = await readRange(sheetId, `${PEDIDOS_SHEET}!A2:A`);
  const patron = new RegExp(`^${prefijo}-(\\d+)$`);
  let max = 0;
  for (const row of col) {
    const m = patron.exec(str(row[0]));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefijo}-${max + 1}`;
}

const fmt = (n: number) => n.toLocaleString("es-CL");

/**
 * Modificación de un pedido ya enviado, solo Adquisiciones (p. ej. el
 * supervisor se equivocó y avisó). Body según `accion`:
 *  - "linea":    `{ pedidoId, fila, codigoActual, codigo, nombre, categoria, unidad, cantidad, comentarioArticulo }`
 *  - "anularLinea" / "reactivarLinea": `{ pedidoId, fila, codigoActual, motivo? }`
 *                (anular conserva la fila con el motivo en la columna Z; exige motivo)
 *  - "agregar":  `{ pedidoId, codigo, nombre, categoria, unidad, cantidad, comentarioArticulo }`
 *  - "cabecera": `{ pedidoId, fechaEntrega, despacho, comentario, solicitante,
 *                  centroNegocio, centroCodigo, clasificador1, clasificador2, urgente, area? }`
 *                `area` (etiqueta) corrige el área del pedido: el pedido toma un folio nuevo
 *                del prefijo de esa área (RCT-62 → SST-xx) y su chat, carpeta de Drive y
 *                etiquetas lo siguen; el centro debe ser de la nueva área.
 * Todo cambio deja un aviso en el chat del pedido.
 */
export async function POST(request: Request) {
  if (!(await haySesion())) return error("No autorizado.", 401);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return error("JSON inválido");
  }

  const accion = str(body.accion);
  const pedidoId = str(body.pedidoId);
  if (!pedidoId) return error("Falta el pedido.");

  const sheetId = articulosSheetId();
  try {
    const rows = await readRange(sheetId, `${PEDIDOS_SHEET}!A2:Z`);
    const delPedido = rows
      .map((r, i) => ({ r, fila: i + 2 }))
      .filter((x) => str(x.r[0]) === pedidoId);
    if (delPedido.length === 0) return error("El pedido ya no existe.", 404);
    const area = str(delPedido[0].r[3]);
    const estado = str(delPedido[0].r[23]).toLowerCase();
    if (estado === "cerrado" || estado === "anulado") {
      return error("El pedido está cerrado o anulado. Reábrelo para modificarlo.", 409);
    }

    if (accion === "linea") {
      const fila = Number(body.fila);
      const objetivo = delPedido.find((x) => x.fila === fila);
      if (!objetivo || str(objetivo.r[11]) !== str(body.codigoActual)) {
        return error("El pedido cambió. Recarga la lista e inténtalo de nuevo.", 409);
      }
      const codigo = str(body.codigo);
      const nombre = str(body.nombre);
      const cantidad = Number(body.cantidad);
      if (!codigo || !nombre) return error("Debes elegir un artículo.");
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        return error("La cantidad debe ser un número mayor a 0.");
      }
      const recibida = Number(objetivo.r[16]) || 0;
      const cambiaArticulo = codigo !== str(objetivo.r[11]);
      if (cambiaArticulo && (recibida > 0 || str(objetivo.r[17]))) {
        return error(
          "Este artículo ya tiene recepción o consumo registrado: no se puede cambiar por otro. Elimínalo y agrega el correcto."
        );
      }
      if (cantidad < recibida) {
        return error(`Ya se recibieron ${fmt(recibida)}: la cantidad no puede ser menor.`);
      }
      if (cambiaArticulo && delPedido.some((x) => x.fila !== fila && str(x.r[11]) === codigo)) {
        return error("Ese artículo ya está en el pedido.");
      }
      const categoria = str(body.categoria);
      const unidad = str(body.unidad) || "UN";
      const comentarioArticulo = str(body.comentarioArticulo);

      await batchWriteRanges(sheetId, [
        { range: `${PEDIDOS_SHEET}!K${fila}:O${fila}`, values: [[categoria, codigo, nombre, unidad, cantidad]] },
        { range: `${PEDIDOS_SHEET}!W${fila}`, values: [[comentarioArticulo]] },
      ]);

      const antes = `${str(objetivo.r[12])} × ${fmt(Number(objetivo.r[14]) || 0)}`;
      await avisarEnChat(pedidoId, area, `«${antes}» ahora es «${nombre} × ${fmt(cantidad)}».`);
      return NextResponse.json({ ok: true });
    }

    if (accion === "anularLinea" || accion === "reactivarLinea") {
      const fila = Number(body.fila);
      const objetivo = delPedido.find((x) => x.fila === fila);
      if (!objetivo || str(objetivo.r[11]) !== str(body.codigoActual)) {
        return error("El pedido cambió. Recarga la lista e inténtalo de nuevo.", 409);
      }
      const nombre = str(objetivo.r[12]);
      const yaAnulada = str(objetivo.r[25]) !== "";

      if (accion === "reactivarLinea") {
        if (!yaAnulada) return NextResponse.json({ ok: true });
        await batchWriteRanges(sheetId, [
          { range: `${PEDIDOS_SHEET}!Z${fila}`, values: [[""]] },
        ]);
        await avisarEnChat(pedidoId, area, `se reactivó «${nombre}».`);
        return NextResponse.json({ ok: true });
      }

      const motivo = str(body.motivo);
      if (!motivo) return error("Indica el motivo de la anulación del artículo.");
      if (yaAnulada) return error("Ese artículo ya está anulado.", 409);
      if ((Number(objetivo.r[16]) || 0) > 0 || str(objetivo.r[17])) {
        return error(
          "Este artículo ya tiene recepción o consumo registrado: no se puede anular."
        );
      }
      const vigentes = delPedido.filter((x) => str(x.r[25]) === "");
      if (vigentes.length <= 1) {
        return error(
          "No se puede anular el único artículo vigente del pedido. Usa «Anular» para el pedido completo."
        );
      }
      await batchWriteRanges(sheetId, [
        { range: `${PEDIDOS_SHEET}!Z${fila}`, values: [[motivo]] },
      ]);
      await avisarEnChat(pedidoId, area, `se anuló «${nombre}» (${motivo}).`);
      return NextResponse.json({ ok: true });
    }

    if (accion === "agregar") {
      const codigo = str(body.codigo);
      const nombre = str(body.nombre);
      const cantidad = Number(body.cantidad);
      if (!codigo || !nombre) return error("Debes elegir un artículo.");
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        return error("La cantidad debe ser un número mayor a 0.");
      }
      if (delPedido.some((x) => str(x.r[11]) === codigo)) {
        return error("Ese artículo ya está en el pedido. Edita su cantidad.");
      }
      // Copia los datos del pedido (A..J, P, T) de una línea existente.
      const base = delPedido[0].r;
      const unidad = str(body.unidad) || "UN";
      await appendRows(sheetId, PEDIDOS_SHEET, [
        [
          pedidoId,
          str(base[1]), str(base[2]), str(base[3]), str(base[4]), str(base[5]),
          str(base[6]), str(base[7]), str(base[8]), str(base[9]),
          str(body.categoria), codigo, nombre, unidad, cantidad,
          str(base[15]),
          "", "", "",
          str(base[19]),
          "", "",
          str(body.comentarioArticulo),
          "", "", "",
        ],
      ]);
      await avisarEnChat(pedidoId, area, `se agregó «${nombre} × ${fmt(cantidad)}».`);
      return NextResponse.json({ ok: true });
    }

    if (accion === "cabecera") {
      const fechaEntrega = str(body.fechaEntrega);
      const despacho = str(body.despacho);
      const comentario = str(body.comentario);
      if (!fechaValida(fechaEntrega)) return error("Fecha inválida (debe ser AAAA-MM-DD).");

      const prev = delPedido[0].r;
      // Los campos que no vienen en el body (clientes antiguos) se dejan como están.
      const solicitante = "solicitante" in body ? str(body.solicitante) : str(prev[2]);
      const centroCodigo = "centroCodigo" in body ? str(body.centroCodigo) : str(prev[5]);
      const centroNegocio = "centroNegocio" in body ? str(body.centroNegocio) : str(prev[4]);
      const clasificador1 = "clasificador1" in body ? str(body.clasificador1) : str(prev[7]);
      const clasificador2 = "clasificador2" in body ? str(body.clasificador2) : str(prev[8]);
      const eraUrgente = ["si", "sí", "s", "1", "true", "urgente"].includes(str(prev[19]).toLowerCase());
      const urgente = "urgente" in body ? body.urgente === true : eraUrgente;

      if (!solicitante) return error("El solicitante no puede quedar vacío.");
      if (!centroCodigo || !centroNegocio) return error("Debes elegir un centro de negocio.");

      // Área: solo cambia si viene en el body y es distinta de la actual.
      let areaNueva = area;
      if ("area" in body) {
        const pedida = AREAS.find((a) => normArea(a.label) === normArea(str(body.area)));
        if (!pedida) return error("Área inválida.");
        areaNueva = pedida.label;
      }
      const cambiaArea = normArea(areaNueva) !== normArea(area);
      if (cambiaArea) {
        const prefijo = PREFIJO_AREA[normArea(areaNueva)];
        if (!prefijo || !centroCodigo.toUpperCase().startsWith(prefijo)) {
          return error(`El centro de negocio debe ser de ${areaNueva}.`);
        }
      }
      if (clasificador1 && clasificador1 !== str(prev[7]) && !CLASIFICADORES_1.includes(clasificador1)) {
        return error("Clasificador 1 inválido.");
      }
      if (clasificador2 && clasificador2 !== str(prev[8]) && !CLASIFICADORES_2.includes(clasificador2)) {
        return error("Clasificador 2 inválido.");
      }

      const cambios: string[] = [];
      if (cambiaArea) cambios.push(`área «${areaNueva}» (antes ${area || "—"})`);
      if (solicitante !== str(prev[2])) cambios.push(`solicitante «${solicitante}»`);
      if (centroCodigo !== str(prev[5])) cambios.push(`centro de negocio «${centroNegocio}»`);
      if (clasificador1 !== str(prev[7])) cambios.push(`clasificador 1 «${clasificador1 || "—"}»`);
      if (clasificador2 !== str(prev[8])) cambios.push(`clasificador 2 «${clasificador2 || "—"}»`);
      if (urgente !== eraUrgente) {
        cambios.push(urgente ? "marcado como urgente" : "ya no es urgente");
      }
      // La planilla guarda «25-11-26»; se compara el día, no el texto, para no
      // reescribir ni avisar un cambio de fecha que no existe.
      const fechaCambia = fechaEntrega !== fechaEntregaAYMD(str(prev[6]));
      if (fechaCambia) cambios.push(`fecha de entrega ${fechaEntrega || "(sin fecha)"}`);
      if (despacho !== str(prev[9])) cambios.push(`despacho «${despacho || "—"}»`);
      if (comentario !== str(prev[15])) cambios.push("comentario del pedido");
      if (cambios.length === 0) return NextResponse.json({ ok: true });

      // Cambio de área: el folio lleva el prefijo del área, así que también cambia.
      const folioNuevo = cambiaArea
        ? await siguienteFolio(sheetId, PREFIJO_AREA[normArea(areaNueva)])
        : pedidoId;

      await batchWriteRanges(
        sheetId,
        delPedido.flatMap((x) => [
          { range: `${PEDIDOS_SHEET}!C${x.fila}`, values: [[solicitante]] },
          ...(cambiaArea
            ? [
                { range: `${PEDIDOS_SHEET}!A${x.fila}`, values: [[folioNuevo]] },
                { range: `${PEDIDOS_SHEET}!D${x.fila}`, values: [[areaNueva]] },
              ]
            : []),
          { range: `${PEDIDOS_SHEET}!E${x.fila}:F${x.fila}`, values: [[centroNegocio, centroCodigo]] },
          ...(fechaCambia
            ? [{ range: `${PEDIDOS_SHEET}!G${x.fila}`, values: [[fechaEntrega]] }]
            : []),
          { range: `${PEDIDOS_SHEET}!H${x.fila}:J${x.fila}`, values: [[clasificador1, clasificador2, despacho]] },
          { range: `${PEDIDOS_SHEET}!P${x.fila}`, values: [[comentario]] },
          { range: `${PEDIDOS_SHEET}!T${x.fila}`, values: [[urgente ? "Sí" : ""]] },
        ])
      );
      if (cambiaArea) {
        // Lo que cuelga del folio viejo se traslada; si algo falla, la planilla
        // ya quedó bien y se informa para corregirlo a mano.
        const pendientes: string[] = [];
        try {
          await renombrarHilo(pedidoId, folioNuevo, normArea(area), normArea(areaNueva));
        } catch {
          pendientes.push("chat");
        }
        try {
          await renombrarCarpetaPedido(pedidoId, folioNuevo);
        } catch {
          pendientes.push("carpeta de Drive");
        }
        try {
          const et = await readRange(sheetId, `${ETIQUETAS_SHEET}!A2:C`);
          const idx = et.findIndex((f) => str(f[0]) === pedidoId);
          if (idx >= 0) {
            await batchWriteRanges(sheetId, [
              { range: `${ETIQUETAS_SHEET}!A${idx + 2}:B${idx + 2}`, values: [[folioNuevo, areaNueva]] },
            ]);
          }
        } catch {
          pendientes.push("etiquetas");
        }
        await avisarEnChat(
          folioNuevo,
          areaNueva,
          `se actualizó ${cambios.join(", ")}. El folio pasó de ${pedidoId} a ${folioNuevo}.`
        );
        return NextResponse.json({ ok: true, nuevoPedidoId: folioNuevo, pendientes });
      }
      await avisarEnChat(pedidoId, area, `se actualizó ${cambios.join(", ")}.`);
      return NextResponse.json({ ok: true });
    }

    return error("Acción desconocida.");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
