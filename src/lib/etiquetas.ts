import { readRange } from "@/lib/google-sheets";

/**
 * Etiquetas de pedidos: las pone cada área para organizar sus propios pedidos
 * (p. ej. "Calderas", "Equipos"). Viven en la pestaña `Etiquetas` del
 * spreadsheet de artículos, una fila por pedido: Pedido ID | Área | Etiquetas
 * (separadas por "|").
 */
export const ETIQUETAS_SHEET = "Etiquetas";
export const ETIQUETAS_HEADERS = ["Pedido ID", "Área", "Etiquetas"];
export const ETIQUETAS_DATA_RANGE = `${ETIQUETAS_SHEET}!A2:C`;
export const MAX_ETIQUETA = 30;
export const MAX_ETIQUETAS_POR_PEDIDO = 10;

/** Texto limpio de una etiqueta, o "" si no sirve. */
export function limpiarEtiqueta(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/[|\s]+/g, " ").trim().slice(0, MAX_ETIQUETA);
}

export function parseEtiquetas(celda: string | undefined): string[] {
  return (celda ?? "")
    .split("|")
    .map((t) => limpiarEtiqueta(t))
    .filter(Boolean);
}

/** Lee la pestaña y devuelve las etiquetas por folio (vacío si no existe). */
export async function leerEtiquetas(
  sheetId: string
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const filas = await readRange(sheetId, ETIQUETAS_DATA_RANGE);
  for (const f of filas) {
    const id = (f[0] ?? "").trim();
    if (id) map.set(id, parseEtiquetas(f[2]));
  }
  return map;
}
