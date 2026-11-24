import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import {
  ESTADOS_OC_ASOCIABLES,
  buscarOCsDeProveedor,
  recepcionOC,
} from "@/lib/defontana";
import { yaConsumido, yaRecepcionado } from "@/lib/marcas-inventario";
import {
  articulosSheetId,
  asegurarColumnas,
  batchWriteRanges,
  readRange,
} from "@/lib/google-sheets";

const PEDIDOS_SHEET = "Pedidos";
const COL_OC = "AA"; // «OC asociada» (índice 26)

const str = (v: unknown) => (typeof v === "string" ? v.trim() : String(v ?? "").trim());

/** Pedido (distinto de `pedidoId`) que ya tiene asociada la OC, o null. */
function otroPedidoDeLaOC(
  rows: string[][],
  oc: string,
  pedidoId: string
): string | null {
  for (const r of rows) {
    if (str(r[26]) === oc && str(r[0]) !== pedidoId) return str(r[0]);
  }
  return null;
}

/**
 * Asociación de pedidos a OC de Defontana (la OC queda anotada por artículo en
 * la columna «OC asociada» de la planilla).
 *
 * Reglas de Adquisiciones (2026-11-23):
 *  - un pedido puede asociarse a una o varias OC (p. ej. distintos proveedores);
 *  - una OC solo puede estar asociada a UN pedido;
 *  - solo se asocian OC en estado Aprobado o Parcialmente Recepcionado.
 *
 * GET ?proveedor=texto           OC asociables de un proveedor (nombre o RUT)
 * GET ?numero=N&pedidoId=X       estado de una OC y si se puede asociar a X
 * GET ?pedidoId=X                datos de las OC ya asociadas a X (para mostrarlas)
 */
export async function GET(request: Request) {
  if (!(await haySesion())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const q = new URL(request.url).searchParams;
  const proveedor = str(q.get("proveedor"));
  const numeroTxt = str(q.get("numero"));
  const pedidoId = str(q.get("pedidoId"));
  try {
    const rows = await readRange(articulosSheetId(), `${PEDIDOS_SHEET}!A2:AA`);

    if (proveedor) {
      if (proveedor.length < 2) return NextResponse.json({ ordenes: [] });
      const todas = await buscarOCsDeProveedor(proveedor);
      const ordenes = todas
        .filter((o) => ESTADOS_OC_ASOCIABLES.includes(o.estado))
        .map((o) => ({
          ...o,
          otroPedido: otroPedidoDeLaOC(rows, String(o.numero), pedidoId),
        }));
      return NextResponse.json({ ordenes });
    }

    if (numeroTxt) {
      const numero = Number(numeroTxt);
      if (!Number.isInteger(numero) || numero <= 0 || numero > 99_999_999) {
        return NextResponse.json({ error: "N° de OC inválido." }, { status: 400 });
      }
      const oc = await recepcionOC(numero);
      if (!oc) return NextResponse.json({ existe: false });
      return NextResponse.json({
        existe: true,
        numero,
        proveedor: oc.proveedorNombre,
        fecha: oc.fecha,
        estado: oc.estadoTexto,
        asociable: ESTADOS_OC_ASOCIABLES.includes(oc.estadoTexto),
        otroPedido: otroPedidoDeLaOC(rows, String(numero), pedidoId),
        codigos: oc.lineas.map((l) => l.codigo),
      });
    }

    if (pedidoId) {
      const numeros = Array.from(
        new Set(
          rows
            .filter((r) => str(r[0]) === pedidoId && str(r[26]) !== "")
            .map((r) => str(r[26]))
        )
      );
      const ordenes: Record<
        string,
        { proveedor: string; fecha: string; estado: string } | null
      > = {};
      await Promise.all(
        numeros.map(async (n) => {
          try {
            const oc = await recepcionOC(Number(n));
            ordenes[n] = oc
              ? { proveedor: oc.proveedorNombre, fecha: oc.fecha, estado: oc.estadoTexto }
              : null;
          } catch {
            ordenes[n] = null;
          }
        })
      );
      return NextResponse.json({ ordenes });
    }

    return NextResponse.json({ error: "Faltan parámetros." }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * Body: { pedidoId, oc, filas: number[] }.
 * `oc` vacío quita la asociación de esas filas.
 */
export async function POST(request: Request) {
  if (!(await haySesion())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  let body: { pedidoId?: unknown; oc?: unknown; filas?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const pedidoId = str(body.pedidoId);
  const ocTxt = str(body.oc);
  const numero = ocTxt === "" ? null : Number(ocTxt);
  if (
    numero !== null &&
    (!Number.isInteger(numero) || numero <= 0 || numero > 99_999_999)
  ) {
    return NextResponse.json({ error: "El N° de OC debe ser un número entero." }, { status: 400 });
  }
  const filas = (Array.isArray(body.filas) ? body.filas : []).map(Number);
  if (
    !pedidoId ||
    filas.length === 0 ||
    filas.length > 200 ||
    filas.some((f) => !Number.isInteger(f) || f < 2) ||
    new Set(filas).size !== filas.length
  ) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
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

    const lineas = filas.map((fila) => ({ fila, row: rows[fila - 2] }));
    for (const { row } of lineas) {
      if (!row || str(row[0]) !== pedidoId) {
        return NextResponse.json(
          { error: "El pedido cambió. Recarga la lista e inténtalo de nuevo." },
          { status: 409 }
        );
      }
      if (str(row[25]) !== "") {
        return NextResponse.json(
          { error: `«${str(row[12])}» está anulado: no se asocia a una OC.` },
          { status: 400 }
        );
      }
      // Un artículo con OC no se reasocia: primero se le quita la OC.
      if (numero !== null && str(row[26]) !== "" && str(row[26]) !== String(numero)) {
        return NextResponse.json(
          {
            error: `«${str(row[12])}» ya está en la OC ${str(row[26])}. Quítale la OC primero.`,
          },
          { status: 409 }
        );
      }
      // Con recepción o consumo ya registrado la OC no se puede cambiar: los
      // movimientos de Defontana quedaron contra esa OC.
      const marca = str(row[17]);
      if (marca !== "" && str(row[26]) !== (numero === null ? "" : String(numero))) {
        if (yaRecepcionado(marca) > 0 || yaConsumido(marca) > 0) {
          return NextResponse.json(
            {
              error: `«${str(row[12])}» ya tiene recepción o consumo registrado (${marca}): su OC no se puede cambiar.`,
            },
            { status: 409 }
          );
        }
      }
    }

    if (numero !== null) {
      const otro = otroPedidoDeLaOC(rows, String(numero), pedidoId);
      if (otro) {
        return NextResponse.json(
          {
            error: `La OC ${numero} ya está asociada al pedido ${otro}. Una OC solo puede asociarse a un pedido.`,
          },
          { status: 409 }
        );
      }
      const oc = await recepcionOC(numero);
      if (!oc) {
        return NextResponse.json(
          { error: `La OC ${numero} no existe en Defontana.` },
          { status: 400 }
        );
      }
      if (!ESTADOS_OC_ASOCIABLES.includes(oc.estadoTexto)) {
        return NextResponse.json(
          {
            error: `La OC ${numero} está «${oc.estadoTexto}». Solo se asocian OC en estado ${ESTADOS_OC_ASOCIABLES.join(" o ")}.`,
          },
          { status: 409 }
        );
      }
      if (oc.codigoPedido && oc.codigoPedido !== pedidoId) {
        return NextResponse.json(
          {
            error: `En Defontana la OC ${numero} ya tiene el «Código Pedido» ${oc.codigoPedido}. Una OC solo puede asociarse a un pedido.`,
          },
          { status: 409 }
        );
      }
      const faltan = lineas
        .map(({ row }) => ({ codigo: str(row[11]), nombre: str(row[12]) }))
        .filter((a) => !oc.lineas.some((l) => l.codigo === a.codigo));
      if (faltan.length > 0) {
        return NextResponse.json(
          {
            error: `La OC ${numero} no incluye: ${faltan.map((a) => `«${a.nombre}»`).join(", ")}. Marca solo los artículos que están en la OC.`,
          },
          { status: 409 }
        );
      }
    }

    // La columna 27 no existe en pestañas creadas antes de esta función.
    await asegurarColumnas(sheetId, PEDIDOS_SHEET, 27);
    await batchWriteRanges(sheetId, [
      { range: `${PEDIDOS_SHEET}!${COL_OC}1`, values: [["OC asociada"]] },
      ...lineas.map(({ fila }) => ({
        range: `${PEDIDOS_SHEET}!${COL_OC}${fila}`,
        values: [[numero === null ? "" : String(numero)]],
      })),
    ]);
    return NextResponse.json({ ok: true, oc: numero === null ? "" : String(numero), filas });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
