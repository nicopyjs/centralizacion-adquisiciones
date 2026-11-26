import { NextResponse } from "next/server";
import { areaLabel, getSesion } from "@/lib/auth";
import { normArea } from "@/lib/chat";
import { htmlDeSolicitud, logoIncrustado } from "@/lib/correo-html";
import { DESTINATARIO_ADQUISICIONES, emailDeArea } from "@/lib/correos";
import { articulosSheetId, readRange } from "@/lib/google-sheets";
import {
  GoogleAuthError,
  enviarCorreo,
  getGoogleEmail,
  guardarCorreoPedido,
  leerCorreoPedido,
  messageIdRfc,
} from "@/lib/google-oauth";

const FOLIO_RE = /^[A-Z]{3}-\d+$/;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : String(v ?? "").trim());

function error(msg: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: msg, ...extra }, { status });
}

/** Saludo según la hora de Chile, como el del formulario. */
function saludo(): string {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: "America/Santiago",
    }).format(new Date())
  );
  return h < 12
    ? "Buenos días, estimados"
    : h < 20
      ? "Buenas tardes, estimados"
      : "Buenas noches, estimados";
}

/**
 * Envía el correo de solicitud de un pedido que quedó registrado en la
 * planilla pero cuyo correo nunca salió (p. ej. sin Google conectado). Se arma
 * con los datos de la planilla, con el mismo formato HTML que el original, y
 * sale desde la cuenta Google de quien lo pide. Body: { folio }.
 *
 * Lo puede enviar Adquisiciones o un supervisor del área del pedido. Los
 * archivos adjuntos y el texto extra del asunto del original no se conservan.
 */
export async function POST(request: Request) {
  const sesion = await getSesion();
  if (!sesion) return error("No autorizado.", 401);
  const email = await getGoogleEmail();
  if (!email) {
    return error("Conecta tu cuenta de Google para enviar el correo.", 401, {
      reconectar: true,
    });
  }

  let folio = "";
  try {
    folio = str(((await request.json()) as { folio?: unknown }).folio);
  } catch {
    return error("JSON inválido", 400);
  }
  if (!FOLIO_RE.test(folio)) return error("Folio inválido.", 400);

  try {
    const filas = (await readRange(articulosSheetId(), "Pedidos!A2:Z")).filter(
      (f) => str(f[0]) === folio
    );
    if (filas.length === 0) return error("El pedido no existe en la planilla.", 404);
    const cab = filas[0];
    const area = str(cab[3]);
    if (
      sesion.perfil !== "adquisiciones" &&
      !(sesion.area && normArea(areaLabel(sesion.area)) === normArea(area))
    ) {
      return error("No autorizado.", 401);
    }
    if (await leerCorreoPedido(folio)) {
      return error("El correo de este pedido ya fue enviado.", 409);
    }

    const articulos = filas
      .filter((f) => str(f[25]) === "")
      .map((f) => ({
        cantidad: Number(f[14]) || 0,
        unidad: str(f[13]),
        nombre: str(f[12]),
        comentario: str(f[22]),
      }));
    if (articulos.length === 0) return error("El pedido no tiene artículos vigentes.", 400);

    const urgente = ["si", "sí", "s", "1", "true", "urgente"].includes(
      str(cab[19]).toLowerCase()
    );
    const centro = str(cab[4]);
    const comentario = str(cab[15]);
    const solicitante = str(cab[2]);
    const asunto = `NEB Chile // Adquisiciones // Pedido ${folio} // ${centro}`;
    const cuerpo = [
      saludo(),
      ...(comentario ? ["", comentario] : []),
      "",
      `Junto con saludar, solicito gestión del siguiente pedido (folio ${folio}):`,
      ...(urgente ? ["", "*** PEDIDO URGENTE ***"] : []),
      "",
      `Área: ${area}`,
      `Centro de Costo: ${centro}`,
      `Clasificador 1: ${str(cab[7])}`,
      `Clasificador 2: ${str(cab[8])}`,
      `Despacho: ${str(cab[9])}`,
      `Fecha de entrega: ${str(cab[6])}${urgente ? " (PEDIDO URGENTE)" : ""}`,
      "",
      "Elementos a solicitar:",
      ...articulos.map(
        (a) =>
          `- ${a.cantidad.toLocaleString("es-CL")} ${a.unidad ? `${a.unidad} ` : ""}${a.nombre}` +
          (a.comentario ? ` (Comentario: ${a.comentario})` : "")
      ),
      "",
      "Saludos,",
      solicitante || "Nombre",
    ].join("\n");

    const html = htmlDeSolicitud(cuerpo, articulos, new URL(request.url).origin);
    const cc = [emailDeArea(area)].filter((a): a is string => !!a && a !== email);

    const enviado = await enviarCorreo(email, {
      para: [DESTINATARIO_ADQUISICIONES],
      cc,
      asunto,
      texto: cuerpo,
      ...(html ? { html, imagenes: [logoIncrustado()] } : {}),
      adjuntos: [],
    });
    const rfcMessageId =
      (await messageIdRfc(email, enviado.id).catch(() => null)) ?? undefined;
    await guardarCorreoPedido({
      folio,
      threadId: enviado.threadId,
      messageId: enviado.id,
      rfcMessageId,
      para: [DESTINATARIO_ADQUISICIONES],
      cc,
      remitente: email,
      asunto,
      ts: Date.now(),
    });
    return NextResponse.json({ ok: true, desde: email });
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      return error(err.message, 401, { reconectar: true });
    }
    console.error("Envío del correo faltante falló:", err);
    return error("No se pudo enviar el correo.", 502);
  }
}
