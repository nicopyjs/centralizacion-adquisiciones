import { LOGO_NEB_ALTO, LOGO_NEB_ANCHO, LOGO_NEB_BASE64 } from "@/lib/neb-logo-correo";

/**
 * Plantilla HTML de los correos del sistema, con el logo y los colores de NEB.
 * Solo tablas y estilos en línea: es lo que soportan Gmail y Outlook. El logo
 * va incrustado (cid) porque la app exige sesión y un enlace a la imagen se
 * vería roto en el correo.
 */

const NEGRO = "#151515";
const AMARILLO = "#e6c027";
const TEXTO = "#1f2937";
const GRIS = "#6b7280";
const LINEA = "#e5e7eb";
const FUENTE = "Arial, Helvetica, sans-serif";

export const LOGO_CID = "neb-logo.jpg";

/** Imagen para pasar en `CorreoSaliente.imagenes` junto con el HTML. */
export function logoIncrustado() {
  return { cid: LOGO_CID, mime: "image/jpeg", datos: Buffer.from(LOGO_NEB_BASE64, "base64") };
}

export function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Texto con saltos de línea → HTML seguro. */
function parrafoHtml(v: string): string {
  return esc(v).replace(/\r?\n/g, "<br>");
}

export type PlantillaCorreo = {
  /** Etiqueta amarilla sobre el título, en mayúsculas. */
  etiqueta: string;
  titulo: string;
  /** Aviso destacado (p. ej. pedido urgente). */
  alerta?: string;
  filas?: [string, string][];
  parrafos?: string[];
  /** Tabla de artículos: cantidad + unidad, nombre y comentario opcional. */
  articulos?: { cantidad: string; nombre: string; comentario?: string }[];
  boton?: { texto: string; url: string };
};

export function correoHtml(p: PlantillaCorreo): string {
  const filas = (p.filas ?? [])
    .filter(([, v]) => v.trim() !== "")
    .map(
      ([k, v]) =>
        `<tr><td style="padding:12px 0;border-bottom:1px solid ${LINEA};color:${GRIS};font-size:14px;width:38%;vertical-align:top">${esc(k)}</td>` +
        `<td style="padding:12px 0;border-bottom:1px solid ${LINEA};color:${NEGRO};font-size:14px;font-weight:bold;vertical-align:top">${esc(v)}</td></tr>`
    )
    .join("");
  const articulos = p.articulos?.length
    ? `<p style="margin:24px 0 8px;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${GRIS}">Elementos a solicitar</p>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">` +
      p.articulos
        .map(
          (a) =>
            `<tr><td style="padding:9px 12px 9px 0;border-bottom:1px solid ${LINEA};font-size:14px;color:${NEGRO};font-weight:bold;white-space:nowrap;vertical-align:top">${esc(a.cantidad)}</td>` +
            `<td style="padding:9px 0;border-bottom:1px solid ${LINEA};font-size:14px;color:${TEXTO};vertical-align:top">${esc(a.nombre)}` +
            (a.comentario
              ? `<br><span style="font-size:12px;color:${GRIS}">${esc(a.comentario)}</span>`
              : "") +
            `</td></tr>`
        )
        .join("") +
      `</table>`
    : "";
  const parrafos = (p.parrafos ?? [])
    .map(
      (t) =>
        `<p style="margin:16px 0 0;font-size:15px;line-height:1.55;color:${TEXTO}">${parrafoHtml(t)}</p>`
    )
    .join("");
  const boton = p.boton
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr>` +
      `<td style="background:${AMARILLO};border-radius:6px"><a href="${esc(p.boton.url)}" style="display:inline-block;padding:13px 26px;font-family:${FUENTE};font-size:15px;font-weight:bold;color:${NEGRO};text-decoration:none">${esc(p.boton.texto)}</a></td>` +
      `</tr></table>`
    : "";
  const alerta = p.alerta
    ? `<p style="margin:0 0 16px;padding:10px 14px;background:#fef3c7;border-left:4px solid ${AMARILLO};font-size:14px;font-weight:bold;color:${NEGRO}">${esc(p.alerta)}</p>`
    : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:${FUENTE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff">
<tr><td style="padding:20px 32px;background:#ffffff"><img src="cid:${LOGO_CID}" width="${Math.round((LOGO_NEB_ANCHO / LOGO_NEB_ALTO) * 44)}" height="44" alt="neb" style="display:block;border:0"></td></tr>
<tr><td style="padding:28px 32px 30px;background:${NEGRO};border-bottom:4px solid ${AMARILLO}">
<p style="margin:0 0 10px;font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${AMARILLO}">${esc(p.etiqueta)}</p>
<h1 style="margin:0;font-size:26px;line-height:1.25;color:#ffffff">${esc(p.titulo)}</h1>
</td></tr>
<tr><td style="padding:24px 32px 32px;font-family:${FUENTE}">
${alerta}${filas ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${filas}</table>` : ""}
${articulos}${parrafos}${boton}
</td></tr>
<tr><td style="padding:16px 32px;background:#f9fafb;border-top:1px solid ${LINEA};font-size:12px;color:${GRIS}">Mensaje automático de Centralización de Adquisiciones · NEB Chile</td></tr>
</table></td></tr></table></body></html>`;
}
