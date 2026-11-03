import { NextResponse } from "next/server";
import { areaLabel, getSesion } from "@/lib/auth";
import { leerAdjuntos } from "@/lib/adjuntos";
import { db, normArea } from "@/lib/chat";
import {
  DESTINATARIO_ADQUISICIONES,
  GERENCIA_EMAILS,
  emailDeArea,
} from "@/lib/correos";
import { articulosSheetId, readRange } from "@/lib/google-sheets";
import {
  GoogleAuthError,
  enviarCorreo,
  getGoogleEmail,
  leerCorreoPedido,
  threadEnMiBuzon,
} from "@/lib/google-oauth";

/**
 * Reporte por correo de un pedido (p. ej. consumo interno): se envía como
 * respuesta en la cadena del correo original del pedido, con copia al área y
 * a gerencia. Solo funciona para pedidos enviados desde la app (que guardan el
 * Message-ID del correo original); los antiguos no tienen cadena registrada.
 *
 *  - GET  ?folio=  → destinatarios, asunto y reportes previos (vista previa).
 *  - POST (multipart) → envía el reporte: folio, oc, nota, items, comentario,
 *                       archivo[].
 */

const FOLIO_RE = /^[A-Z]{3}-\d+$/;
const kReportes = (folio: string) => `mail:reportes:${folio}`;

type Reporte = { ts: number; por: string; oc: string; nota: string };

function error(msg: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: msg, ...extra }, { status });
}

/** Área del pedido (texto de la planilla) si la sesión puede verlo; si no, null. */
async function areaAccesible(folio: string): Promise<string | null | undefined> {
  const sesion = await getSesion();
  if (!sesion) return undefined;
  const filas = await readRange(articulosSheetId(), "Pedidos!A2:D");
  const fila = filas.find((f) => String(f[0] ?? "").trim() === folio);
  if (!fila) return null;
  const area = String(fila[3] ?? "").trim();
  if (sesion.perfil === "adquisiciones") return area;
  if (sesion.area && normArea(areaLabel(sesion.area)) === normArea(area)) return area;
  return undefined;
}

function destinatarios(remitente: string, area: string, yo: string | null) {
  const sinYo = (l: string[]) => l.filter((a) => a !== yo);
  const para = sinYo([...new Set([remitente, DESTINATARIO_ADQUISICIONES])]);
  const emailArea = emailDeArea(area);
  const cc = sinYo(
    [...new Set([...(emailArea ? [emailArea] : []), ...GERENCIA_EMAILS])].filter(
      (a) => !para.includes(a)
    )
  );
  return { para, cc };
}

const asuntoRe = (a: string) => (/^re:/i.test(a) ? a : `Re: ${a}`);

export async function GET(request: Request) {
  const folio = new URL(request.url).searchParams.get("folio")?.trim() ?? "";
  if (!FOLIO_RE.test(folio)) return error("Folio inválido.", 400);
  const area = await areaAccesible(folio);
  if (area === undefined) return error("No autorizado.", 401);
  if (area === null) return error("El pedido no existe.", 404);

  const original = await leerCorreoPedido(folio);
  const reportes =
    (await db().lrange<Reporte>(kReportes(folio), 0, -1).catch(() => [])) ?? [];
  if (!original?.rfcMessageId) {
    return NextResponse.json({ tieneCadena: false, reportes });
  }
  const yo = await getGoogleEmail();
  return NextResponse.json({
    tieneCadena: true,
    asunto: asuntoRe(original.asunto),
    ...destinatarios(original.remitente, area, yo),
    reportes,
  });
}

export async function POST(request: Request) {
  const email = await getGoogleEmail();
  if (!email) {
    return error("Conecta tu cuenta de Google para enviar el reporte.", 401, {
      reconectar: true,
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error("Solicitud inválida.", 400);
  }
  const campo = (k: string, max: number) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim().slice(0, max) : "";
  };
  const folio = campo("folio", 20);
  const oc = campo("oc", 40);
  const nota = campo("nota", 120);
  const items = campo("items", 6000);
  const comentario = campo("comentario", 2000);
  if (!FOLIO_RE.test(folio)) return error("Folio inválido.", 400);
  if (!oc) return error("Indica el N° de OC.", 400);

  const area = await areaAccesible(folio);
  if (area === undefined) return error("No autorizado.", 401);
  if (area === null) return error("El pedido no existe.", 404);

  const original = await leerCorreoPedido(folio);
  if (!original?.rfcMessageId) {
    return error(
      "Este pedido no tiene su cadena de correo registrada (solo los pedidos enviados desde la app).",
      409
    );
  }

  const leidos = await leerAdjuntos(form);
  if (!leidos.ok) return error(leidos.error, leidos.status);

  const texto = [
    "Estimados,",
    "",
    `Adjunto consumo interno de la OC ${oc}`,
    "",
    `NOTA: ${folio}${nota ? ` ${nota}` : ""}`,
    ...(items ? [items] : []),
    ...(comentario ? ["", comentario] : []),
  ].join("\n");

  const { para, cc } = destinatarios(original.remitente, area, email);
  try {
    // El threadId es distinto en cada buzón: se busca por Message-ID. Si quien
    // reporta no tiene el correo original, el reporte igual sale con las
    // cabeceras de respuesta y los demás lo ven dentro de la cadena.
    const threadId = await threadEnMiBuzon(email, original.rfcMessageId).catch(
      () => null
    );
    await enviarCorreo(email, {
      para,
      cc,
      asunto: asuntoRe(original.asunto),
      texto,
      adjuntos: leidos.adjuntos,
      inReplyTo: original.rfcMessageId,
      threadId: threadId ?? undefined,
    });
    const reporte: Reporte = { ts: Date.now(), por: email, oc, nota };
    await db().rpush(kReportes(folio), reporte);
    return NextResponse.json({ ok: true, reporte, enCadena: threadId !== null });
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      return error(err.message, 401, { reconectar: true });
    }
    console.error("Reporte por correo falló:", err);
    return error("No se pudo enviar el reporte.", 502);
  }
}
