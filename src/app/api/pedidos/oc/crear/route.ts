import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import {
  ambienteDefontana,
  buscarProveedores,
  condicionesPago,
  crearOC,
  formatearRut,
} from "@/lib/defontana";
import {
  articulosSheetId,
  asegurarColumnas,
  batchWriteRanges,
  readRange,
} from "@/lib/google-sheets";

const PEDIDOS_SHEET = "Pedidos";
const COL_OC = "AA"; // «OC asociada» (índice 26)

const str = (v: unknown) => (typeof v === "string" ? v.trim() : String(v ?? "").trim());
const esYMD = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Fecha de hoy en Chile ("YYYY-MM-DD"). */
function hoyChile(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
}

/**
 * Crear una OC en Defontana a partir de artículos de un pedido.
 *
 * GET ?proveedor=texto   proveedores activos (nombre o RUT) con su condición de pago
 * GET                    catálogo de condiciones de pago y ambiente de Defontana
 */
export async function GET(request: Request) {
  if (!(await haySesion())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const proveedor = str(new URL(request.url).searchParams.get("proveedor"));
  try {
    if (proveedor) {
      if (proveedor.length < 2) return NextResponse.json({ proveedores: [] });
      return NextResponse.json({ proveedores: await buscarProveedores(proveedor) });
    }
    return NextResponse.json({
      condiciones: await condicionesPago(),
      ambiente: ambienteDefontana(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * Body: { pedidoId, proveedor (RUT), condicionPago, fechaRecepcion, exenta,
 *         lineas: [{ fila, precio }] }.
 * La cantidad, el centro de negocio y los clasificadores salen de la planilla.
 * Al crearse, la OC queda asociada a esas filas (columna «OC asociada»).
 */
export async function POST(request: Request) {
  if (!(await haySesion())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  let body: {
    pedidoId?: unknown;
    proveedor?: unknown;
    condicionPago?: unknown;
    fechaRecepcion?: unknown;
    exenta?: unknown;
    lineas?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const pedidoId = str(body.pedidoId);
  const proveedor = str(body.proveedor);
  const condicionPago = str(body.condicionPago);
  const fechaRecepcion = str(body.fechaRecepcion);
  const entradas = (Array.isArray(body.lineas) ? body.lineas : []).map((l) => ({
    fila: Number((l as { fila?: unknown })?.fila),
    precio: Number((l as { precio?: unknown })?.precio),
  }));
  if (
    !pedidoId ||
    !proveedor ||
    !condicionPago ||
    !esYMD(fechaRecepcion) ||
    entradas.length === 0 ||
    entradas.length > 200 ||
    entradas.some(
      (l) =>
        !Number.isInteger(l.fila) || l.fila < 2 || !Number.isFinite(l.precio) || l.precio <= 0
    ) ||
    new Set(entradas.map((l) => l.fila)).size !== entradas.length
  ) {
    return NextResponse.json(
      { error: "Datos inválidos: revisa proveedor, condición de pago, fecha y precios." },
      { status: 400 }
    );
  }

  try {
    const sheetId = articulosSheetId();
    const rows = await readRange(sheetId, `${PEDIDOS_SHEET}!A2:AA`);
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

    const lineas = entradas.map((e) => ({ ...e, row: rows[e.fila - 2] }));
    for (const { row } of lineas) {
      if (!row || str(row[0]) !== pedidoId) {
        return NextResponse.json(
          { error: "El pedido cambió. Recarga la lista e inténtalo de nuevo." },
          { status: 409 }
        );
      }
      if (str(row[25]) !== "") {
        return NextResponse.json(
          { error: `«${str(row[12])}» está anulado: no va en una OC.` },
          { status: 400 }
        );
      }
      if (str(row[26]) !== "") {
        return NextResponse.json(
          {
            error: `«${str(row[12])}» ya está en la OC ${str(row[26])}. Quítala primero (Asociar OC → Quitar OC).`,
          },
          { status: 409 }
        );
      }
      if (str(row[11]) === "" || !(Number(row[14]) > 0)) {
        return NextResponse.json(
          { error: `«${str(row[12])}» no tiene código de artículo o cantidad.` },
          { status: 400 }
        );
      }
    }

    const cabecera = lineas[0].row;
    const centro = str(cabecera[5]);
    if (!centro) {
      return NextResponse.json({ error: "El pedido no tiene centro de negocio." }, { status: 400 });
    }

    const { numero, omitidos } = await crearOC({
      proveedorRut: formatearRut(proveedor),
      centroNegocio: centro,
      condicionPago,
      fechaEmision: hoyChile(),
      fechaRecepcion,
      exenta: body.exenta === true,
      comentario: `Pedido ${pedidoId}`,
      codigoPedido: pedidoId,
      clasificador1: str(cabecera[7]),
      clasificador2: str(cabecera[8]),
      lineas: lineas.map(({ row, precio }) => ({
        codigo: str(row[11]),
        cantidad: Number(row[14]),
        precio,
        comentario: str(row[12]),
      })),
    });

    // La OC ya existe en Defontana: si falla la planilla hay que avisar el N°.
    try {
      await asegurarColumnas(sheetId, PEDIDOS_SHEET, 27);
      await batchWriteRanges(sheetId, [
        { range: `${PEDIDOS_SHEET}!${COL_OC}1`, values: [["OC asociada"]] },
        ...lineas.map(({ fila }) => ({
          range: `${PEDIDOS_SHEET}!${COL_OC}${fila}`,
          values: [[String(numero)]],
        })),
      ]);
    } catch {
      return NextResponse.json(
        {
          error: `La OC ${numero} se creó en Defontana pero no se pudo asociar al pedido. Asóciala con «Asociar OC» (N° ${numero}).`,
        },
        { status: 502 }
      );
    }
    return NextResponse.json({
      ok: true,
      oc: numero,
      filas: lineas.map((l) => l.fila),
      omitidos,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
