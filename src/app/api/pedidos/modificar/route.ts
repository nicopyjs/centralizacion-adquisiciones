import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import { agregarMensaje, normArea } from "@/lib/chat";
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

const fmt = (n: number) => n.toLocaleString("es-CL");

/**
 * Modificación de un pedido ya enviado, solo Adquisiciones (p. ej. el
 * supervisor se equivocó y avisó). Body según `accion`:
 *  - "linea":    `{ pedidoId, fila, codigoActual, codigo, nombre, categoria, unidad, cantidad, comentarioArticulo }`
 *  - "agregar":  `{ pedidoId, codigo, nombre, categoria, unidad, cantidad, comentarioArticulo }`
 *  - "cabecera": `{ pedidoId, fechaEntrega, despacho, comentario, solicitante,
 *                  centroNegocio, centroCodigo, clasificador1, clasificador2, urgente }`
 *                (el área no se cambia: define el folio, el chat y quién ve el pedido)
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
    const rows = await readRange(sheetId, `${PEDIDOS_SHEET}!A2:Y`);
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
          "", "",
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
      if (clasificador1 && clasificador1 !== str(prev[7]) && !CLASIFICADORES_1.includes(clasificador1)) {
        return error("Clasificador 1 inválido.");
      }
      if (clasificador2 && clasificador2 !== str(prev[8]) && !CLASIFICADORES_2.includes(clasificador2)) {
        return error("Clasificador 2 inválido.");
      }

      const cambios: string[] = [];
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

      await batchWriteRanges(
        sheetId,
        delPedido.flatMap((x) => [
          { range: `${PEDIDOS_SHEET}!C${x.fila}`, values: [[solicitante]] },
          { range: `${PEDIDOS_SHEET}!E${x.fila}:F${x.fila}`, values: [[centroNegocio, centroCodigo]] },
          ...(fechaCambia
            ? [{ range: `${PEDIDOS_SHEET}!G${x.fila}`, values: [[fechaEntrega]] }]
            : []),
          { range: `${PEDIDOS_SHEET}!H${x.fila}:J${x.fila}`, values: [[clasificador1, clasificador2, despacho]] },
          { range: `${PEDIDOS_SHEET}!P${x.fila}`, values: [[comentario]] },
          { range: `${PEDIDOS_SHEET}!T${x.fila}`, values: [[urgente ? "Sí" : ""]] },
        ])
      );
      await avisarEnChat(pedidoId, area, `se actualizó ${cambios.join(", ")}.`);
      return NextResponse.json({ ok: true });
    }

    return error("Acción desconocida.");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
