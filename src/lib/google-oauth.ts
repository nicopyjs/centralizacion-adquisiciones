import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { OAuth2Client } from "google-auth-library";
import { db } from "@/lib/chat";
import {
  GOOGLE_COOKIE,
  GOOGLE_SESSION_SECONDS,
  clave,
  crearTokenSesion,
  emailDeToken,
} from "@/lib/google-cookie";

export { GOOGLE_COOKIE, GOOGLE_SESSION_SECONDS, crearTokenSesion };

/**
 * Login con Google (OAuth "interno" de Workspace) para enviar correos como la
 * persona que usa la app, con la Gmail API.
 *
 *  - Cookie `google_session`: email firmado con HMAC (solo identifica a quien
 *    conectó su cuenta; no da acceso al panel de gestión).
 *  - El refresh token de cada usuario vive en Redis, cifrado con AES-256-GCM:
 *    `gmail:tok:<email>`.
 *  - Por cada pedido enviado se guarda `mail:pedido:<folio>` con el threadId y
 *    el id del mensaje, para poder responder en la misma cadena (fase 2).
 *
 * Variables de entorno: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET.
 * Opcional: GOOGLE_TOKEN_SECRET (clave para firmar/cifrar; por defecto se
 * deriva del client secret).
 */

export const DOMINIO = "nebchile.cl";
export const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];
const SCOPE_ENVIAR = "https://www.googleapis.com/auth/gmail.send";

export const GOOGLE_STATE_COOKIE = "google_oauth_state";


export function oauthConfigurado(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
}

export function redirectUri(request: Request): string {
  return `${new URL(request.url).origin}/api/auth/google/callback`;
}

export function crearCliente(request?: Request): OAuth2Client {
  return new OAuth2Client(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    request ? redirectUri(request) : undefined
  );
}

/** Solo rutas internas ("/algo"), nunca URLs externas ni "//host". */
export function rutaSegura(v: unknown, porDefecto = "/enviar-pedido"): string {
  return typeof v === "string" && /^\/(?!\/)[^\s\\]*$/.test(v) ? v : porDefecto;
}

// --- Sesión (cookie firmada) -------------------------------------------------

/** Email de la cuenta Google conectada, o null. */
export async function getGoogleEmail(): Promise<string | null> {
  if (!oauthConfigurado()) return null;
  const store = await cookies();
  return emailDeToken(store.get(GOOGLE_COOKIE)?.value);
}

// --- Refresh token cifrado en Redis -----------------------------------------

const kToken = (email: string) => `gmail:tok:${email}`;

function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", clave(), iv);
  const data = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
}

function descifrar(valor: string): string {
  const buf = Buffer.from(valor, "base64");
  const d = createDecipheriv("aes-256-gcm", clave(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

export async function guardarRefreshToken(email: string, token: string) {
  await db().set(kToken(email), cifrar(token));
}

export async function borrarRefreshToken(email: string) {
  await db().del(kToken(email));
}

async function leerRefreshToken(email: string): Promise<string | null> {
  const v = await db().get<string>(kToken(email));
  if (!v) return null;
  try {
    return descifrar(v);
  } catch {
    return null;
  }
}

/** ¿Los permisos concedidos incluyen el envío de correo? */
export function concedioEnvio(scope: string | undefined | null): boolean {
  return (scope ?? "").split(/\s+/).includes(SCOPE_ENVIAR);
}

export class GoogleAuthError extends Error {}

async function accessToken(email: string): Promise<string> {
  const refresh = await leerRefreshToken(email);
  if (!refresh) throw new GoogleAuthError("Vuelve a conectar tu cuenta de Google.");
  const cliente = crearCliente();
  cliente.setCredentials({ refresh_token: refresh });
  try {
    const { token } = await cliente.getAccessToken();
    if (!token) throw new Error("sin token");
    return token;
  } catch {
    // Revocado o vencido: hay que volver a autorizar.
    await borrarRefreshToken(email);
    throw new GoogleAuthError("Vuelve a conectar tu cuenta de Google.");
  }
}

// --- Envío de correo ---------------------------------------------------------

export type AdjuntoSaliente = { nombre: string; mime: string; datos: Buffer };

export type CorreoSaliente = {
  para: string[];
  cc: string[];
  asunto: string;
  texto: string;
  adjuntos?: AdjuntoSaliente[];
  /** Para responder: cadena en el buzón de quien envía + cabeceras RFC 822. */
  threadId?: string;
  inReplyTo?: string;
};

/** Texto no ASCII en una cabecera (RFC 2047). */
function cabeceraMime(texto: string): string {
  return `=?UTF-8?B?${Buffer.from(texto, "utf8").toString("base64")}?=`;
}

function base64Lineas(datos: string | Buffer): string {
  const buf = typeof datos === "string" ? Buffer.from(datos, "utf8") : datos;
  return (buf.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function construirMime(c: CorreoSaliente): string {
  const comunes = [
    `To: ${c.para.join(", ")}`,
    ...(c.cc.length ? [`Cc: ${c.cc.join(", ")}`] : []),
    `Subject: ${cabeceraMime(c.asunto)}`,
    ...(c.inReplyTo
      ? [`In-Reply-To: ${c.inReplyTo}`, `References: ${c.inReplyTo}`]
      : []),
    "MIME-Version: 1.0",
  ];
  const cuerpoTexto = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lineas(c.texto),
  ];

  if (!c.adjuntos?.length) {
    return [...comunes, ...cuerpoTexto].join("\r\n");
  }

  const limite = `neb_${randomBytes(12).toString("hex")}`;
  const partes = [`--${limite}`, ...cuerpoTexto];
  for (const a of c.adjuntos) {
    const nombre = cabeceraMime(a.nombre);
    partes.push(
      `--${limite}`,
      `Content-Type: ${a.mime}; name="${nombre}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${nombre}"`,
      "",
      base64Lineas(a.datos)
    );
  }
  partes.push(`--${limite}--`);
  return [
    ...comunes,
    `Content-Type: multipart/mixed; boundary="${limite}"`,
    "",
    ...partes,
  ].join("\r\n");
}

export type CorreoEnviado = { id: string; threadId: string };

/** Envía un correo desde la cuenta Gmail de `email` (la que se conectó). */
export async function enviarCorreo(
  email: string,
  correo: CorreoSaliente
): Promise<CorreoEnviado> {
  const token = await accessToken(email);
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: Buffer.from(construirMime(correo)).toString("base64url"),
        ...(correo.threadId ? { threadId: correo.threadId } : {}),
      }),
    }
  );
  if (res.status === 401 || res.status === 403) {
    throw new GoogleAuthError(
      "Gmail rechazó el envío. Vuelve a conectar tu cuenta de Google."
    );
  }
  if (!res.ok) {
    throw new Error(`Gmail respondió ${res.status}.`);
  }
  const data = (await res.json()) as { id: string; threadId: string };
  return { id: data.id, threadId: data.threadId };
}

/** Message-ID (cabecera RFC 822) de un mensaje del buzón de `email`. */
export async function messageIdRfc(
  email: string,
  idMensaje: string
): Promise<string | null> {
  const token = await accessToken(email);
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
      idMensaje
    )}?format=metadata&metadataHeaders=Message-ID`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    payload?: { headers?: { name: string; value: string }[] };
  };
  return (
    data.payload?.headers?.find((h) => h.name.toLowerCase() === "message-id")
      ?.value ?? null
  );
}

/**
 * threadId, en el buzón de `email`, de la cadena que contiene el mensaje con
 * ese Message-ID. El threadId es distinto en el buzón de cada persona, por eso
 * se busca por Message-ID. null si esa cuenta no tiene el mensaje.
 */
export async function threadEnMiBuzon(
  email: string,
  rfcMessageId: string
): Promise<string | null> {
  const token = await accessToken(email);
  const q = `rfc822msgid:${rfcMessageId.replace(/^<|>$/g, "")}`;
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=${encodeURIComponent(
      q
    )}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { messages?: { threadId: string }[] };
  return data.messages?.[0]?.threadId ?? null;
}

// --- Cadena de correo de cada pedido -----------------------------------------

export type CorreoPedido = {
  folio: string;
  threadId: string;
  messageId: string;
  /** Message-ID RFC 822 del correo original (para responder en la cadena). */
  rfcMessageId?: string;
  para?: string[];
  cc?: string[];
  remitente: string;
  asunto: string;
  ts: number;
};

const kCorreoPedido = (folio: string) => `mail:pedido:${folio}`;

export async function leerCorreoPedido(
  folio: string
): Promise<CorreoPedido | null> {
  return (await db().get<CorreoPedido>(kCorreoPedido(folio))) ?? null;
}

export async function guardarCorreoPedido(c: CorreoPedido) {
  await db().set(kCorreoPedido(c.folio), c);
}
