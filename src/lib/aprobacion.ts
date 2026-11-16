import { emailDeArea } from "@/lib/correos";
import { correoHtml, logoIncrustado } from "@/lib/correo-html";
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
      imagenes: [logoIncrustado()],
      html: correoHtml({
        etiqueta: "Pedido por aprobar",
        titulo: `${p.solicitante} hizo un pedido`,
        alerta: p.urgente ? "Pedido urgente" : undefined,
        filas: [
          ["Pedido", p.pedidoId],
          ["Área", p.area],
          ["Centro de negocio", p.centro],
          ["Artículos", String(p.lineas)],
        ],
        parrafos: ["Revísalo y apruébalo en la aplicación. Hasta que un supervisor lo apruebe, Adquisiciones no lo ve."],
        boton: { texto: "Revisar pedido", url: `${p.origen}/mis-pedidos?pedido=${encodeURIComponent(p.pedidoId)}` },
      }),
      texto: [
        `${p.solicitante} hizo un pedido que espera tu aprobación.`,
        "",
        `Pedido: ${p.pedidoId}`,
        `Área: ${p.area}`,
        `Centro de negocio: ${p.centro}`,
        `Artículos: ${p.lineas}`,
        "",
        `Revísalo y apruébalo en: ${p.origen}/mis-pedidos?pedido=${encodeURIComponent(p.pedidoId)}`,
        "Hasta que un supervisor lo apruebe, Adquisiciones no lo ve.",
      ].join("\n"),
    });
  } catch (err) {
    if (!(err instanceof GoogleAuthError)) console.error("Aviso de aprobación:", err);
  }
}

export type LineaAprobada = { nombre: string; cantidad: number; unidad: string; comentario: string };

/**
 * Al aprobar un pedido de maestros, avisa a Adquisiciones (con el grupo del
 * área en copia) con el mismo formato del correo de solicitud de siempre.
 * Sale desde `NOTIFICACIONES_REMITENTE`; devuelve false si no se pudo enviar
 * (el pedido ya está aprobado y visible en Gestión de Pedidos igual).
 */
export async function avisarAprobacion(p: {
  pedidoId: string;
  area: string;
  centro: string;
  solicitante: string;
  aprobador: string;
  clasificador1: string;
  clasificador2: string;
  despacho: string;
  fechaEntrega: string;
  comentario: string;
  urgente: boolean;
  lineas: LineaAprobada[];
  cambios: string[];
  origen: string;
}): Promise<boolean> {
  const remitente = process.env.NOTIFICACIONES_REMITENTE?.trim().toLowerCase();
  if (!remitente) return false;
  const cc = emailDeArea(p.area);
  const elementos = p.lineas
    .map((l) => {
      const base = `- ${l.cantidad.toLocaleString("es-CL")} ${l.unidad ? `${l.unidad} ` : ""}${l.nombre}`;
      return l.comentario ? `${base} (Comentario: ${l.comentario})` : base;
    })
    .join("\n");
  try {
    await enviarCorreo(remitente, {
      para: ["adquisiciones@nebchile.cl"],
      cc: cc ? [cc] : [],
      asunto: `NEB Chile // Adquisiciones // ${p.centro} // Pedido ${p.pedidoId}`,
      imagenes: [logoIncrustado()],
      html: correoHtml({
        etiqueta: "Pedido aprobado",
        titulo: `Pedido ${p.pedidoId} listo para gestionar`,
        alerta: p.urgente ? "PEDIDO URGENTE" : undefined,
        filas: [
          ["Solicitante", p.solicitante],
          ["Aprobado por", p.aprobador],
          ["Área", p.area],
          ["Centro de Costo", p.centro],
          ["Clasificador 1", p.clasificador1],
          ["Clasificador 2", p.clasificador2],
          ["Despacho", p.despacho],
          ["Fecha de entrega", `${p.fechaEntrega}${p.urgente ? " (urgente)" : ""}`],
        ],
        parrafos: [
          ...(p.comentario ? [p.comentario] : []),
          ...(p.cambios.length ? [`El supervisor ajustó el pedido: ${p.cambios.join("; ")}.`] : []),
        ],
        articulos: p.lineas.map((l) => ({
          cantidad: `${l.cantidad.toLocaleString("es-CL")}${l.unidad ? ` ${l.unidad}` : ""}`,
          nombre: l.nombre,
          comentario: l.comentario || undefined,
        })),
        boton: { texto: "Gestionar pedido", url: `${p.origen}/gestion-pedidos?pedido=${encodeURIComponent(p.pedidoId)}` },
      }),
      texto: [
        "Junto con saludar, se aprobó el siguiente pedido de un maestro; solicito su gestión:",
        ...(p.urgente ? ["", "*** PEDIDO URGENTE ***"] : []),
        "",
        `Pedido: ${p.pedidoId}`,
        `Solicitante: ${p.solicitante}`,
        `Aprobado por: ${p.aprobador}`,
        `Área: ${p.area}`,
        `Centro de Costo: ${p.centro}`,
        `Clasificador 1: ${p.clasificador1}`,
        `Clasificador 2: ${p.clasificador2}`,
        `Despacho: ${p.despacho}`,
        `Fecha de entrega: ${p.fechaEntrega}${p.urgente ? " (PEDIDO URGENTE)" : ""}`,
        ...(p.comentario ? ["", p.comentario] : []),
        "",
        "Elementos a solicitar:",
        elementos,
        ...(p.cambios.length ? ["", `El supervisor ajustó el pedido: ${p.cambios.join("; ")}.`] : []),
        "",
        `Gestiónalo en: ${p.origen}/gestion-pedidos?pedido=${encodeURIComponent(p.pedidoId)}`,
      ].join("\n"),
    });
    return true;
  } catch (err) {
    if (!(err instanceof GoogleAuthError)) console.error("Aviso de aprobación:", err);
    return false;
  }
}
