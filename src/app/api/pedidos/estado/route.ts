import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import {
  articulosSheetId,
  batchWriteRanges,
  readRange,
} from "@/lib/google-sheets";

const PEDIDOS_SHEET = "Pedidos";

const ESTADOS: Record<string, string> = {
  cerrado: "Cerrado",
  anulado: "Anulado",
  "": "",
};

/**
 * Cierra, anula o reabre un pedido completo (todas sus líneas) escribiendo en
 * las columnas X (Estado pedido) e Y (Motivo estado). No borra filas: así queda
 * el historial y el folio no se reutiliza. Reabrir = estado vacío.
 */
export async function POST(request: Request) {
  if (!(await haySesion())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  let body: {
    pedidoId?: unknown;
    pedidoIds?: unknown;
    estado?: unknown;
    motivo?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  // Acepta un pedido (`pedidoId`) o varios a la vez (`pedidoIds`).
  const ids = new Set<string>(
    (Array.isArray(body.pedidoIds)
      ? body.pedidoIds
      : [body.pedidoId]
    )
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean)
  );
  const estadoKey = typeof body.estado === "string" ? body.estado : "";
  const motivo = typeof body.motivo === "string" ? body.motivo.trim() : "";
  if (ids.size === 0) {
    return NextResponse.json({ error: "Falta el pedido." }, { status: 400 });
  }
  if (ids.size > 200) {
    return NextResponse.json({ error: "Demasiados pedidos." }, { status: 400 });
  }
  if (!(estadoKey in ESTADOS)) {
    return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
  }
  if (estadoKey === "anulado" && !motivo) {
    return NextResponse.json(
      { error: "Para anular indica el motivo (quién lo pidió y por qué)." },
      { status: 400 }
    );
  }

  try {
    const sheetId = articulosSheetId();
    const col = await readRange(sheetId, `${PEDIDOS_SHEET}!A2:A`);
    const encontrados = new Set<string>();
    const data: { range: string; values: string[][] }[] = [
      // Encabezados de las dos columnas nuevas (idempotente).
      {
        range: `${PEDIDOS_SHEET}!X1:Y1`,
        values: [["Estado pedido", "Motivo estado"]],
      },
    ];
    col.forEach((row, i) => {
      const id = (row[0] ?? "").trim();
      if (ids.has(id)) {
        encontrados.add(id);
        const fila = i + 2;
        data.push({
          range: `${PEDIDOS_SHEET}!X${fila}:Y${fila}`,
          values: [[ESTADOS[estadoKey], estadoKey === "" ? "" : motivo]],
        });
      }
    });
    if (data.length === 1) {
      return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });
    }
    await batchWriteRanges(sheetId, data);
    return NextResponse.json({
      ok: true,
      lineas: data.length - 1,
      pedidos: Array.from(encontrados),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
