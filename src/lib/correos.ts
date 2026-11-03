/**
 * Destinatarios fijos de los correos del sistema (todos @nebchile.cl).
 * `GERENCIA_EMAIL` puede definirse como variable de entorno (lista separada
 * por comas) para no tocar el código si cambia la dirección.
 */
export const DESTINATARIO_ADQUISICIONES = "adquisiciones@nebchile.cl";

export const GERENCIA_EMAILS: string[] = (
  process.env.GERENCIA_EMAIL || "gerencia@nebchile.cl"
)
  .split(/[,;]/)
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** Correo del grupo de cada área, según la columna "Área" de la planilla. */
const EMAIL_AREA: Record<string, string> = {
  refacciones: "refacciones@nebchile.cl",
  "servicio técnico": "serviciotecnico@nebchile.cl",
  instalaciones: "instalaciones@nebchile.cl",
  "transición y postventa": "typ@nebchile.cl",
};

export function emailDeArea(label: string): string | null {
  return EMAIL_AREA[label.trim().toLowerCase()] ?? null;
}
