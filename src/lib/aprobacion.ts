/**
 * Aprobación de pedidos hechos por maestros (sin cuenta @nebchile.cl).
 *
 * El estado vive en la columna X ("Estado pedido") de la hoja Pedidos, la misma
 * de Cerrado/Anulado, así no hay columnas nuevas:
 *  - "Pendiente aprobación": el maestro lo envió y ningún supervisor lo vio.
 *    Adquisiciones NO lo ve (GET /api/pedidos lo omite).
 *  - "Rechazado": un supervisor lo rechazó; el motivo va en la columna Y.
 *  - (vacío): aprobado, o pedido hecho directamente por una cuenta @nebchile.cl.
 */
export const PENDIENTE_APROBACION = "Pendiente aprobación";
export const RECHAZADO = "Rechazado";

export type EstadoAprobacion = "pendiente" | "rechazado";

/** Estado de aprobación según el valor de la columna X, o null si no aplica. */
export function estadoAprobacion(x: string): EstadoAprobacion | null {
  const v = x.trim().toLowerCase();
  if (v === PENDIENTE_APROBACION.toLowerCase()) return "pendiente";
  if (v === RECHAZADO.toLowerCase()) return "rechazado";
  return null;
}

/** Minúsculas y sin tildes, para comparar nombres y áreas. */
export function norm(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
