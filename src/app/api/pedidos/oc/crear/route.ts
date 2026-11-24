import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import {
  CODIGO_ARTICULO_MANUAL,
  ambienteDefontana,
  buscarProveedores,
  categoriasArticulo,
  condicionesPago,
  crearArticulo,
  crearOC,
  formatearRut,
  unidadesArticulo,
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
    const [condiciones, categorias, unidades] = await Promise.all([
      condicionesPago(),
      categoriasArticulo(),
      unidadesArticulo(),
    ]);
    return NextResponse.json({
      condiciones,
      categorias,
      unidades,
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
  const entradas = (Array.isArray(body.lineas) ? body.lineas : []).map((l) => {
    const o = (l ?? {}) as { fila?: unknown; precio?: unknown; categoriaId?: unknown; unidad?: unknown };
    return {
      fila: Number(o.fila),
      precio: Number(o.precio),
      categoriaId: Number(o.categoriaId),
      unidad: str(o.unidad),
    };
  });
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

    // Artículos manuales (sin código en el catálogo): se crean en Defontana con
    // la categoría elegida, y el código nuevo se anota en la planilla de
    // inmediato, así un reintento no los duplica si la OC falla después.
    const manuales = lineas.filter(({ row }) => str(row[11]) === CODIGO_ARTICULO_MANUAL);
    const articulosCreados: { fila: number; codigo: string; categoria: string }[] = [];
    if (manuales.length > 0) {
      const [categorias, unidades] = await Promise.all([categoriasArticulo(), unidadesArticulo()]);
      for (const m of manuales) {
        const nombre = str(m.row[12]);
        if (!categorias.some((c) => c.id === m.categoriaId)) {
          return NextResponse.json(
            { error: `Elige la categoría de «${nombre}» para crearlo en Defontana.` },
            { status: 400 }
          );
        }
        if (!unidades.some((u) => u.codigo === m.unidad)) {
          return NextResponse.json(
            { error: `Elige la unidad de «${nombre}» para crearlo en Defontana.` },
            { status: 400 }
          );
        }
      }
      for (const m of manuales) {
        const categoria = categorias.find((c) => c.id === m.categoriaId)!;
        const codigo = await crearArticulo({
          nombre: str(m.row[12]),
          unidad: m.unidad,
          categoriaId: m.categoriaId,
          precio: m.precio,
        });
        m.row[11] = codigo;
        m.row[10] = categoria.nombre;
        m.row[13] = m.unidad;
        articulosCreados.push({ fila: m.fila, codigo, categoria: categoria.nombre });
        await batchWriteRanges(sheetId, [
          {
            range: `${PEDIDOS_SHEET}!K${m.fila}:L${m.fila}`,
            values: [[categoria.nombre, codigo]],
          },
          { range: `${PEDIDOS_SHEET}!N${m.fila}`, values: [[m.unidad]] },
        ]);
      }
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
      articulosCreados,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
