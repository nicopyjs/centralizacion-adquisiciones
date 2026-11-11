/**
 * Marcas que la app deja en la columna «Consumo interno» de la planilla:
 *   "REC-3787/PE-2052 (1 · BC14)"  recepción de OC: sube el stock (activo),
 *                                  todavía falta el consumo interno.
 *   "CI-2302 (1 · BODEGACENTRAL)"  consumo interno: baja el stock e imputa
 *                                  el gasto al centro.
 *   "PECD-2210/OC-4650 (1 · BC14)"  ingreso con costo directo (parte de
 *                                  entrada costo directo): a diferencia de
 *                                  REC/PE, este documento imputa el gasto
 *                                  directo a la cuenta de la categoría del
 *                                  artículo (no pasa por la cuenta de
 *                                  mercaderías) — por eso NO lleva un consumo
 *                                  interno después; cuenta como recepcionado
 *                                  y consumido a la vez. El "/OC-NNN" es
 *                                  opcional (solo trazabilidad: Defontana NO
 *                                  marca esa OC como recepcionada con este
 *                                  documento, a diferencia de REC/PE).
 * Varias marcas se separan con " | " y las cantidades se acumulan, así una
 * línea puede recepcionarse (u ocuparse) o consumirse en partes.
 */
const MARCA_REC = /REC-\d+(?:\/PE-[\d+]+)? \(([\d.]+) ·/g;
const MARCA_CI = /CI-\d+ \(([\d.]+) ·/g;
const CUALQUIER_CI = /CI-\d+/g;
const MARCA_PECD = /PECD-\d+(?:\/OC-\d+)? \(([\d.]+) ·/g;

/** Unidades de la línea ya recepcionadas en la OC desde esta app. */
export function yaRecepcionado(marca: string): number {
  return (
    [...marca.matchAll(MARCA_REC)].reduce((a, m) => a + Number(m[1]), 0) +
    [...marca.matchAll(MARCA_PECD)].reduce((a, m) => a + Number(m[1]), 0)
  );
}

/**
 * Unidades ya consumidas (gasto ya imputado al centro). Un CI escrito a mano
 * sin cantidad («CI-2302») no se puede cuantificar: se trata como línea
 * totalmente consumida. Un PECD cuenta igual: ya imputó el gasto él solo.
 */
export function yaConsumido(marca: string): number {
  const con = [...marca.matchAll(MARCA_CI)];
  const todos = marca.match(CUALQUIER_CI) ?? [];
  if (todos.length > con.length) return Infinity;
  return (
    con.reduce((a, m) => a + Number(m[1]), 0) +
    [...marca.matchAll(MARCA_PECD)].reduce((a, m) => a + Number(m[1]), 0)
  );
}
