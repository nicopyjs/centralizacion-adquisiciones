import { NextResponse } from "next/server";
import {
  appendRows,
  ensureSheet,
  getSpreadsheetMeta,
  readRange,
} from "@/lib/google-sheets";

const PEDIDOS_SHEET = "Pedidos";
const HEADERS = [
  "Pedido ID",
  "Fecha",
  "Solicitante",
  "Área",
  "Categoría",
  "Código",
  "Artículo",
  "Unidad",
  "Cantidad",
  "Comentario",
];

type ItemInput = {
  codigo?: unknown;
  nombre?: unknown;
  categoria?: unknown;
  unidad?: unknown;
  cantidad?: unknown;
};

type PedidoInput = {
  solicitante?: unknown;
  area?: unknown;
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
  const area = str(body.area);
  const comentario = str(body.comentario);
  const rawItems = Array.isArray(body.items) ? (body.items as ItemInput[]) : [];

  if (!solicitante) {
    return NextResponse.json(
      { error: "El campo 'solicitante' es obligatorio." },
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

  try {
    const meta = await getSpreadsheetMeta();
    const exists = meta.sheets.some(
      (s) => s.properties.title === PEDIDOS_SHEET
    );
    if (!exists) {
      await ensureSheet(PEDIDOS_SHEET);
      await appendRows(PEDIDOS_SHEET, [HEADERS]);
    } else {
      const firstRow = await readRange(`${PEDIDOS_SHEET}!A1:J1`);
      if (!firstRow.length || !firstRow[0].length) {
        await appendRows(PEDIDOS_SHEET, [HEADERS]);
      }
    }

    const rows = items.map((it) => [
      pedidoId,
      fecha,
      solicitante,
      area,
      it.categoria,
      it.codigo,
      it.nombre,
      it.unidad,
      it.cantidad,
      comentario,
    ]);

    await appendRows(PEDIDOS_SHEET, rows);

    return NextResponse.json({ ok: true, pedidoId, lineas: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
