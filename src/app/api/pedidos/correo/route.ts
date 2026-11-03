import { NextResponse } from "next/server";
import { leerAdjuntos } from "@/lib/adjuntos";
import { articulosSheetId, readRange } from "@/lib/google-sheets";
import {
  DOMINIO,
  GoogleAuthError,
  enviarCorreo,
  getGoogleEmail,
  guardarCorreoPedido,
  leerCorreoPedido,
  messageIdRfc,
} from "@/lib/google-oauth";

const DESTINATARIO = "adquisiciones@nebchile.cl";
const MAX_CC = 5;
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+$/;

function error(msg: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: msg, ...extra }, { status });
}

/**
 * Envía por la Gmail API el correo de solicitud de un pedido ya registrado,
 * desde la cuenta Google conectada, y guarda la cadena (threadId) del pedido.
 * Los destinatarios se limitan a direcciones @nebchile.cl.
 */
export async function POST(request: Request) {
  const email = await getGoogleEmail();
  if (!email) {
    return error("Conecta tu cuenta de Google para enviar el correo.", 401, {
      reconectar: true,
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error("Solicitud inválida.", 400);
  }

  const campo = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  const folio = campo("folio").trim();
  const asunto = campo("asunto").trim();
  const cuerpo = campo("cuerpo");
  if (!/^[A-Z]{3}-\d+$/.test(folio)) return error("Folio inválido.", 400);
  if (!asunto || asunto.length > 300) return error("Asunto inválido.", 400);
  if (!cuerpo.trim() || cuerpo.length > 50_000) return error("Cuerpo inválido.", 400);

  const leidos = await leerAdjuntos(form);
  if (!leidos.ok) return error(leidos.error, leidos.status);
  const adjuntos = leidos.adjuntos;

  const cc = campo("cc")
    .split(/[,;]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (
    cc.length > MAX_CC ||
    cc.some((a) => !EMAIL_RE.test(a) || !a.endsWith(`@${DOMINIO}`))
  ) {
    return error("Copia (CC) inválida: solo direcciones @nebchile.cl.", 400);
  }

  // Solo se envía el correo de pedidos que existen en la planilla.
  const folios = await readRange(articulosSheetId(), "Pedidos!A2:A");
  if (!folios.some((f) => String(f[0] ?? "").trim() === folio)) {
    return error("El pedido no existe en la planilla.", 404);
  }
  if (await leerCorreoPedido(folio)) {
    return error("El correo de este pedido ya fue enviado.", 409);
  }

  try {
    const enviado = await enviarCorreo(email, {
      para: [DESTINATARIO],
      cc,
      asunto,
      texto: cuerpo,
      adjuntos,
    });
    // El Message-ID permite responder después en la cadena desde otro buzón.
    const rfcMessageId =
      (await messageIdRfc(email, enviado.id).catch(() => null)) ?? undefined;
    await guardarCorreoPedido({
      folio,
      threadId: enviado.threadId,
      messageId: enviado.id,
      rfcMessageId,
      para: [DESTINATARIO],
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
    console.error("Envío de correo falló:", err);
    return error("No se pudo enviar el correo.", 502);
  }
}
