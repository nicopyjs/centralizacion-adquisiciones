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
  /** Texto libre antes de los datos (p. ej. el comentario del solicitante). */
  introduccion?: string;
  filas?: [string, string][];
  parrafos?: string[];
  /** Tabla de artículos: cantidad + unidad, nombre y comentario opcional. */
  articulos?: { cantidad: string; nombre: string; comentario?: string }[];
  /** Enlaces a archivos (Drive), con su título. */
  enlaces?: { titulo: string; items: { texto: string; url: string }[] };
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
  const enlaces = p.enlaces?.items.length
    ? `<p style="margin:24px 0 8px;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${GRIS}">${esc(p.enlaces.titulo)}</p>` +
      p.enlaces.items
        .map(
          (e) =>
            `<p style="margin:0 0 6px;font-size:14px"><a href="${esc(e.url)}" style="color:#0369a1;text-decoration:underline">${esc(e.texto)}</a></p>`
        )
        .join("")
    : "";
  const boton = p.boton
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr>` +
      `<td style="background:${AMARILLO};border-radius:6px"><a href="${esc(p.boton.url)}" style="display:inline-block;padding:13px 26px;font-family:${FUENTE};font-size:15px;font-weight:bold;color:${NEGRO};text-decoration:none">${esc(p.boton.texto)}</a></td>` +
      `</tr></table>`
    : "";
  const intro = p.introduccion
    ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${TEXTO}">${parrafoHtml(p.introduccion)}</p>`
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
${alerta}${intro}${filas ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${filas}</table>` : ""}
${articulos}${enlaces}${parrafos}${boton}
</td></tr>
<tr><td style="padding:16px 32px;background:#f9fafb;border-top:1px solid ${LINEA};font-size:12px;color:${GRIS}">Mensaje automático de Centralización de Adquisiciones · NEB Chile</td></tr>
</table></td></tr></table></body></html>`;
}

export type ArticuloSolicitud = {
  cantidad: number;
  unidad: string;
  nombre: string;
  comentario: string;
};

const CAMPOS_SOLICITUD = [
  "Área",
  "Centro de Costo",
  "Clasificador 1",
  "Clasificador 2",
  "Despacho",
  "Fecha de entrega",
];

/**
 * HTML del correo de solicitud de pedido a partir de su texto (el que arma el
 * formulario) y de los artículos. Devuelve null si el texto no tiene la forma
 * esperada: en ese caso el correo sale solo en texto plano.
 */
export function htmlDeSolicitud(
  cuerpo: string,
  articulos: ArticuloSolicitud[],
  origen: string
): string | null {
  const lineas = cuerpo.replace(/\r\n/g, "\n").split("\n");
  const iIntro = lineas.findIndex((l) => l.startsWith("Junto con saludar"));
  if (iIntro < 0) return null;
  const folio = /\(folio ([A-Z]{3}-\d+)\)/.exec(lineas[iIntro])?.[1] ?? "";
  const comentario = lineas.slice(1, iIntro).join("\n").trim();
  const urgente = lineas.some((l) => l.trim() === "*** PEDIDO URGENTE ***");

  const filas: [string, string][] = [];
  for (const campo of CAMPOS_SOLICITUD) {
    const l = lineas.slice(iIntro).find((x) => x.startsWith(`${campo}: `));
    if (l) filas.push([campo, l.slice(campo.length + 2).trim()]);
  }
  if (filas.length === 0) return null;

  const iSaludos = lineas.lastIndexOf("Saludos,");
  const solicitante = iSaludos >= 0 ? (lineas[iSaludos + 1] ?? "").trim() : "";
  if (solicitante) filas.unshift(["Solicitante", solicitante]);

  // Enlaces a archivos subidos a Drive: «- nombre: https://…».
  const items = lineas
    .map((l) => /^- (.+): (https?:\/\/\S+)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ texto: m[1], url: m[2] }));
  const fallidos = lineas.find((l) => l.startsWith("No se pudieron subir:"));

  return correoHtml({
    etiqueta: urgente ? "Nuevo pedido · urgente" : "Nuevo pedido",
    titulo: folio ? `Solicitud de pedido ${folio}` : "Solicitud de pedido",
    alerta: urgente ? "PEDIDO URGENTE" : undefined,
    filas,
    introduccion: comentario || undefined,
    parrafos: fallidos ? [fallidos] : [],
    articulos: articulos.map((a) => ({
      cantidad: `${a.cantidad.toLocaleString("es-CL")}${a.unidad ? ` ${a.unidad}` : ""}`,
      nombre: a.nombre,
      comentario: a.comentario || undefined,
    })),
    enlaces: items.length
      ? { titulo: "Archivos (se abren con tu sesión en la aplicación)", items }
      : undefined,
    boton: { texto: "Gestionar pedido", url: `${origen}/gestion-pedidos` },
  });
}
