/**
 * Marcas que la app deja en la columna «Consumo interno» de la planilla:
 *   "REC-3787/PE-2052 (1 · BC14)"  recepción de OC (1 = unidades)
 *   "CI-2302 (1 · BODEGACENTRAL)"  consumo interno
 * Varias marcas se separan con " | " y las cantidades se acumulan, así una
 * línea puede recepcionarse o consumirse en partes.
 */
const MARCA_REC = /REC-\d+(?:\/PE-[\d+]+)? \(([\d.]+) ·/g;
const MARCA_CI = /CI-\d+ \(([\d.]+) ·/g;
const CUALQUIER_CI = /CI-\d+/g;

/** Unidades de la línea ya recepcionadas en la OC desde esta app. */
export function yaRecepcionado(marca: string): number {
  return [...marca.matchAll(MARCA_REC)].reduce((a, m) => a + Number(m[1]), 0);
}

/**
 * Unidades ya consumidas. Un CI escrito a mano sin cantidad («CI-2302») no se
 * puede cuantificar: se trata como línea totalmente consumida.
 */
export function yaConsumido(marca: string): number {
  const con = [...marca.matchAll(MARCA_CI)];
  const todos = marca.match(CUALQUIER_CI) ?? [];
  if (todos.length > con.length) return Infinity;
  return con.reduce((a, m) => a + Number(m[1]), 0);
}
