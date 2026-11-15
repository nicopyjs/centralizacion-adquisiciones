import { emailDeArea } from "@/lib/correos";
import { GoogleAuthError, enviarCorreo } from "@/lib/google-oauth";

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

/**
 * Avisa por correo al grupo del área que hay un pedido por aprobar. Sale desde
 * la cuenta indicada en `NOTIFICACIONES_REMITENTE` (debe haber conectado su
 * Google en la app al menos una vez). Es un aviso de cortesía: si no está
 * configurado o falla, el pedido igual queda pendiente y el supervisor lo ve
 * en «Pedidos del Área».
 */
export async function avisarSupervisores(p: {
  pedidoId: string;
  area: string;
  solicitante: string;
  centro: string;
  lineas: number;
  urgente: boolean;
  origen: string;
}): Promise<void> {
  const remitente = process.env.NOTIFICACIONES_REMITENTE?.trim().toLowerCase();
  const para = emailDeArea(p.area);
  if (!remitente || !para) return;
  try {
    await enviarCorreo(remitente, {
      para: [para],
      cc: [],
      asunto: `${p.urgente ? "[URGENTE] " : ""}Pedido ${p.pedidoId} por aprobar · ${p.area}`,
      texto: [
        `${p.solicitante} hizo un pedido que espera tu aprobación.`,
        "",
        `Pedido: ${p.pedidoId}`,
        `Área: ${p.area}`,
        `Centro de negocio: ${p.centro}`,
        `Artículos: ${p.lineas}`,
        "",
        `Revísalo y apruébalo en: ${p.origen}/mis-pedidos`,
        "Hasta que un supervisor lo apruebe, Adquisiciones no lo ve.",
      ].join("\n"),
    });
  } catch (err) {
    if (!(err instanceof GoogleAuthError)) console.error("Aviso de aprobación:", err);
  }
}
