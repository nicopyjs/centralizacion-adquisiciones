import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import {
  AVISO_RECEPCION,
  ambienteDefontana,
  crearConsumoInterno,
  problemasRecepcion,
  recepcionOC,
} from "@/lib/defontana";
import {
  articulosSheetId,
  batchWriteRanges,
  readRange,
} from "@/lib/google-sheets";

const PEDIDOS_SHEET = "Pedidos";
/** Marca que se escribe en «Consumo interno» (col. R) al registrar: "CI-2302". */
const YA_REGISTRADO = /CI-\d+/;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : String(v ?? "").trim());

/**
 * Registra en Defontana un consumo interno (documento CI) con artículos ya
 * recepcionados de un pedido y deja el folio en la columna «Consumo interno».
 *
 * Body: { pedidoId, bodega, lineas: [{ fila, cantidad }] }
 * Todo lo demás (código de artículo, centro, clasificadores) se lee de la
 * planilla en el servidor, no del cliente.
 */
export async function POST(request: Request) {
  if (!(await haySesion())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  let body: {
    pedidoId?: unknown;
    bodega?: unknown;
    oc?: unknown;
    sinOc?: unknown;
    lineas?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const pedidoId = str(body.pedidoId);
  const bodega = str(body.bodega);
  const ocTexto = str(body.oc);
  const ocNumero = ocTexto === "" ? undefined : Number(ocTexto);
  if (ocNumero === undefined && body.sinOc !== true) {
    return NextResponse.json(
      {
        error:
          "Indica el N° de OC, o marca «Sin OC» si el material ya estaba en bodega.",
      },
      { status: 400 }
    );
  }
  if (
    ocNumero !== undefined &&
    (!Number.isInteger(ocNumero) || ocNumero <= 0 || ocNumero > 99_999_999)
  ) {
    return NextResponse.json(
      { error: "El N° de OC debe ser un número entero (o déjalo vacío)." },
      { status: 400 }
    );
  }
  const pedidas: { fila?: unknown; cantidad?: unknown }[] = Array.isArray(
    body.lineas
  )
    ? body.lineas
    : [];
  const lineas = pedidas.map((l) => ({
    fila: Number(l?.fila),
    cantidad: Number(l?.cantidad),
  }));
  if (!pedidoId || !bodega || lineas.length === 0 || lineas.length > 100) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  if (
    lineas.some(
      (l) =>
        !Number.isInteger(l.fila) ||
        l.fila < 2 ||
        !Number.isFinite(l.cantidad) ||
        l.cantidad <= 0
    ) ||
    new Set(lineas.map((l) => l.fila)).size !== lineas.length
  ) {
    return NextResponse.json({ error: "Líneas inválidas." }, { status: 400 });
  }

  try {
    const sheetId = articulosSheetId();
    const rows = await readRange(sheetId, `${PEDIDOS_SHEET}!A2:Y`);
    const delPedido = rows.filter((r) => str(r[0]) === pedidoId);
    if (delPedido.length === 0) {
      return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });
    }
    if (["cerrado", "anulado"].includes(str(delPedido[0][23]).toLowerCase())) {
      return NextResponse.json(
        { error: "El pedido está cerrado o anulado. Reábrelo primero." },
        { status: 409 }
      );
    }

    const detalle = [];
    for (const l of lineas) {
      const row = rows[l.fila - 2];
      if (!row || str(row[0]) !== pedidoId) {
        return NextResponse.json(
          { error: "El pedido cambió. Recarga la lista e inténtalo de nuevo." },
          { status: 409 }
        );
      }
      const nombre = str(row[12]);
      const recibida = Number(str(row[16]));
      if (!(recibida > 0)) {
        return NextResponse.json(
          { error: `«${nombre}» aún no tiene cantidad recibida.` },
          { status: 400 }
        );
      }
      if (l.cantidad > recibida) {
        return NextResponse.json(
          { error: `«${nombre}»: la cantidad supera lo recibido (${recibida}).` },
          { status: 400 }
        );
      }
      if (YA_REGISTRADO.test(str(row[17]))) {
        return NextResponse.json(
          {
            error: `«${nombre}» ya tiene un consumo interno registrado (${str(row[17])}).`,
          },
          { status: 409 }
        );
      }
      detalle.push({ ...l, codigo: str(row[11]), nombre, previo: str(row[17]) });
    }

    const cabecera = delPedido[0];
    const centro = str(cabecera[5]);
    if (!centro) {
      return NextResponse.json(
        { error: "El pedido no tiene código de centro de negocio." },
        { status: 400 }
      );
    }

    // Con OC: el material debe estar recepcionado en Defontana (parte de
    // entrada); si no, el stock no existe o no corresponde a esta OC.
    if (ocNumero !== undefined) {
      const oc = await recepcionOC(ocNumero);
      if (!oc) {
        return NextResponse.json(
          { error: `La OC ${ocNumero} no existe en Defontana.` },
          { status: 400 }
        );
      }
      const problemas = problemasRecepcion(
        oc,
        detalle.map((d) => ({ codigo: d.codigo, nombre: d.nombre, cantidad: d.cantidad }))
      );
      if (problemas.length > 0) {
        return NextResponse.json(
          { error: `OC ${ocNumero}: ${problemas.join("; ")}. ${AVISO_RECEPCION}` },
          { status: 409 }
        );
      }
    }

    const fecha = new Date().toLocaleDateString("sv-SE", {
      timeZone: "America/Santiago",
    });
    const { folio } = await crearConsumoInterno({
      externalId: `${pedidoId}-${Date.now().toString(36)}`,
      fecha,
      glosa: [pedidoId, str(cabecera[15])].filter(Boolean).join(" - ").slice(0, 200),
      bodega,
      centroNegocio: centro,
      ocNumero,
      lineas: detalle.map((d) => ({ articleId: d.codigo, cantidad: d.cantidad })),
    });

    const anotaciones = detalle.map((d) => ({
      fila: d.fila,
      consumoInterno: [d.previo, `CI-${folio} (${d.cantidad} · ${bodega})`]
        .filter(Boolean)
        .join(" | "),
    }));

    // El documento ya existe en Defontana: si falla la planilla, el error
    // incluye el folio para no duplicarlo a ciegas.
    try {
      await batchWriteRanges(
        sheetId,
        anotaciones.map((a) => ({
          range: `${PEDIDOS_SHEET}!R${a.fila}`,
          values: [[a.consumoInterno]],
        }))
      );
    } catch {
      return NextResponse.json(
        {
          error: `El consumo interno SÍ se creó en Defontana (folio CI-${folio}) pero no se pudo anotar en la planilla. Anótalo a mano en «Consumo interno»; no lo registres de nuevo.`,
          folio,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      folio,
      ambiente: ambienteDefontana(),
      lineas: anotaciones,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
