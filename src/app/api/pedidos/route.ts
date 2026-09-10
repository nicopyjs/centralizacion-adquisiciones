import { NextResponse } from "next/server";
import {
  appendRows,
  articulosSheetId,
  ensureSheet,
  getSpreadsheetMeta,
  readRange,
  writeRange,
} from "@/lib/google-sheets";

const PEDIDOS_SHEET = "Pedidos";
const HEADERS = [
  "Pedido ID",
  "Fecha",
  "Solicitante",
  "Área",
  "Centro de negocio",
  "Centro Código",
  "Fecha entrega",
  "Clasificador 1",
  "Clasificador 2",
  "Despacho",
  "Categoría",
  "Código",
  "Artículo",
  "Unidad",
  "Cantidad",
  "Comentario",
];
// Última columna de encabezados (16 columnas -> A..P).
const HEADERS_RANGE = `${PEDIDOS_SHEET}!A1:P1`;

type ItemInput = {
  codigo?: unknown;
  nombre?: unknown;
  categoria?: unknown;
  unidad?: unknown;
  cantidad?: unknown;
};

type PedidoInput = {
  solicitante?: unknown;
  area?: { label?: unknown; email?: unknown } | null;
  centroNegocio?: { codigo?: unknown; descripcion?: unknown } | null;
  fechaEntrega?: unknown;
  clasificador1?: unknown;
  clasificador2?: unknown;
  despacho?: unknown;
  comentario?: unknown;
  items?: unknown;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

export async function POST(request: Request) {
  let body: PedidoInput;
  try {
    body = (await request.json()) as PedidoInput;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const solicitante = str(body.solicitante);
  const area = str(body.area?.label);
  const centroCodigo = str(body.centroNegocio?.codigo);
  const centroDescripcion = str(body.centroNegocio?.descripcion);
  const fechaEntrega = str(body.fechaEntrega);
  const clasificador1 = str(body.clasificador1);
  const clasificador2 = str(body.clasificador2);
  const despacho = str(body.despacho);
  const comentario = str(body.comentario);
  const rawItems = Array.isArray(body.items) ? (body.items as ItemInput[]) : [];

  if (!solicitante) {
    return NextResponse.json(
      { error: "El campo 'solicitante' es obligatorio." },
      { status: 400 }
    );
  }

  if (!centroCodigo || !centroDescripcion) {
    return NextResponse.json(
      { error: "Debes seleccionar un centro de negocio." },
      { status: 400 }
    );
  }

  const items = rawItems
    .map((it) => ({
      codigo: str(it.codigo),
      nombre: str(it.nombre),
      categoria: str(it.categoria),
      unidad: str(it.unidad) || "UN",
      cantidad: Number(it.cantidad),
    }))
    .filter((it) => it.codigo && Number.isFinite(it.cantidad) && it.cantidad > 0);

  if (items.length === 0) {
    return NextResponse.json(
      { error: "El pedido debe tener al menos un artículo con cantidad válida." },
      { status: 400 }
    );
  }

  const pedidoId = `PED-${Date.now()}`;
  const fecha = new Date().toISOString();
  const sheetId = articulosSheetId();

  try {
    const meta = await getSpreadsheetMeta(sheetId);
    const exists = meta.sheets.some((s) => s.properties.title === PEDIDOS_SHEET);

    if (!exists) {
      await ensureSheet(sheetId, PEDIDOS_SHEET);
      await appendRows(sheetId, PEDIDOS_SHEET, [HEADERS]);
    } else {
      // Asegura que la fila de encabezados esté al día.
      const firstRow = await readRange(sheetId, HEADERS_RANGE);
      const current = firstRow[0] ?? [];
      const matches =
        current.length === HEADERS.length &&
        HEADERS.every((h, i) => (current[i] ?? "") === h);
      if (!matches) {
        await writeRange(sheetId, HEADERS_RANGE, [HEADERS]);
      }
    }

    const rows = items.map((it) => [
      pedidoId,
      fecha,
      solicitante,
      area,
      centroDescripcion,
      centroCodigo,
      fechaEntrega,
      clasificador1,
      clasificador2,
      despacho,
      it.categoria,
      it.codigo,
      it.nombre,
      it.unidad,
      it.cantidad,
      comentario,
    ]);

    await appendRows(sheetId, PEDIDOS_SHEET, rows);

    return NextResponse.json({ ok: true, pedidoId, lineas: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
