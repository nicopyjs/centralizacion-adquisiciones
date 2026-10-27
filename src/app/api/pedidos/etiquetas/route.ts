import { NextResponse } from "next/server";
import { areaLabel, getSesion } from "@/lib/auth";
import {
  ETIQUETAS_DATA_RANGE,
  ETIQUETAS_HEADERS,
  ETIQUETAS_SHEET,
  MAX_ETIQUETAS_POR_PEDIDO,
  limpiarEtiqueta,
  parseEtiquetas,
} from "@/lib/etiquetas";
import {
  appendRows,
  articulosSheetId,
  batchWriteRanges,
  ensureSheet,
  getSpreadsheetMeta,
  readRange,
  writeRange,
} from "@/lib/google-sheets";

type Body = { pedidoIds?: unknown; agregar?: unknown; quitar?: unknown };

function lista(v: unknown): string[] {
  return Array.isArray(v) ? v.map(limpiarEtiqueta).filter(Boolean) : [];
}

/**
 * Agrega y/o quita etiquetas a uno o varios pedidos. Adquisiciones puede
 * etiquetar cualquier pedido; supervisor/maestro solo los de su área.
 */
export async function POST(request: Request) {
  const sesion = await getSesion();
  const soloArea =
    sesion && sesion.perfil !== "adquisiciones" && sesion.area
      ? areaLabel(sesion.area).toLowerCase()
      : null;
  if (!sesion || (sesion.perfil !== "adquisiciones" && !soloArea)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const pedidoIds = Array.isArray(body.pedidoIds)
    ? Array.from(
        new Set(
          body.pedidoIds
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim())
            .filter(Boolean)
        )
      )
    : [];
  const agregar = lista(body.agregar);
  const quitar = lista(body.quitar);

  if (pedidoIds.length === 0 || pedidoIds.length > 200) {
    return NextResponse.json(
      { error: "Selecciona entre 1 y 200 pedidos." },
      { status: 400 }
    );
  }
  if (agregar.length === 0 && quitar.length === 0) {
    return NextResponse.json({ error: "No hay cambios que guardar." }, { status: 400 });
  }

  const sheetId = articulosSheetId();
  try {
    // Área de cada folio (para validar que el pedido sea de la sesión).
    const pedidos = await readRange(sheetId, "Pedidos!A2:D");
    const areaPorFolio = new Map<string, string>();
    for (const r of pedidos) {
      const id = (r[0] ?? "").trim();
      if (id && !areaPorFolio.has(id)) areaPorFolio.set(id, (r[3] ?? "").trim());
    }
    for (const id of pedidoIds) {
      const area = areaPorFolio.get(id);
      if (area === undefined) {
        return NextResponse.json(
          { error: `El pedido ${id} no existe.` },
          { status: 400 }
        );
      }
      if (soloArea !== null && area.toLowerCase() !== soloArea) {
        return NextResponse.json({ error: "No autorizado." }, { status: 401 });
      }
    }

    const meta = await getSpreadsheetMeta(sheetId);
    let filas: string[][] = [];
    if (meta.sheets.some((s) => s.properties.title === ETIQUETAS_SHEET)) {
      filas = await readRange(sheetId, ETIQUETAS_DATA_RANGE);
    } else {
      await ensureSheet(sheetId, ETIQUETAS_SHEET);
      await writeRange(sheetId, `${ETIQUETAS_SHEET}!A1:C1`, [ETIQUETAS_HEADERS]);
    }

    const filaDe = new Map<string, number>();
    filas.forEach((f, i) => {
      const id = (f[0] ?? "").trim();
      if (id && !filaDe.has(id)) filaDe.set(id, i + 2);
    });

    const quitarSet = new Set(quitar.map((t) => t.toLowerCase()));
    const escrituras: { range: string; values: (string | number)[][] }[] = [];
    const nuevas: string[][] = [];
    const resultado: Record<string, string[]> = {};

    for (const id of pedidoIds) {
      const fila = filaDe.get(id);
      const actuales = fila ? parseEtiquetas(filas[fila - 2]?.[2]) : [];
      const sig = actuales.filter((t) => !quitarSet.has(t.toLowerCase()));
      for (const t of agregar) {
        if (!sig.some((x) => x.toLowerCase() === t.toLowerCase())) sig.push(t);
      }
      if (sig.length > MAX_ETIQUETAS_POR_PEDIDO) {
        return NextResponse.json(
          {
            error: `Un pedido admite hasta ${MAX_ETIQUETAS_POR_PEDIDO} etiquetas (${id}).`,
          },
          { status: 400 }
        );
      }
      resultado[id] = sig;
      const area = areaPorFolio.get(id) ?? "";
      if (fila) {
        escrituras.push({
          range: `${ETIQUETAS_SHEET}!A${fila}:C${fila}`,
          values: [[id, area, sig.join("|")]],
        });
      } else if (sig.length > 0) {
        nuevas.push([id, area, sig.join("|")]);
      }
    }

    await batchWriteRanges(sheetId, escrituras);
    if (nuevas.length > 0) await appendRows(sheetId, ETIQUETAS_SHEET, nuevas);

    return NextResponse.json({ ok: true, etiquetas: resultado });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
