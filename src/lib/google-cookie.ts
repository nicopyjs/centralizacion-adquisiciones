import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Cookie de sesión de Google (email firmado con HMAC). Vive aparte de
 * `google-oauth.ts` porque el proxy la verifica en cada petición y no debe
 * arrastrar Redis ni la librería de Google.
 */

export const GOOGLE_COOKIE = "google_session";
export const GOOGLE_SESSION_SECONDS = 60 * 60 * 24 * 30; // 30 días

export function clave(): Buffer {
  const base =
    process.env.GOOGLE_TOKEN_SECRET ||
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
    "";
  if (!base) throw new Error("Falta GOOGLE_OAUTH_CLIENT_SECRET.");
  return createHash("sha256").update(`neb-google:${base}`).digest();
}

export function firmar(payload: string): string {
  return createHmac("sha256", clave()).update(payload).digest("hex");
}

export function iguales(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function crearTokenSesion(email: string): string {
  const payload = `${Buffer.from(email).toString("base64url")}.${
    Date.now() + GOOGLE_SESSION_SECONDS * 1000
  }`;
  return `${payload}.${firmar(payload)}`;
}

/** Email @nebchile.cl de una cookie válida y vigente, o null (también si falta la clave). */
export function emailDeToken(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const [b64, exp, firma] = token.split(".");
    if (!b64 || !exp || !firma) return null;
    if (!iguales(firma, firmar(`${b64}.${exp}`))) return null;
    if (Number(exp) <= Date.now()) return null;
    const email = Buffer.from(b64, "base64url").toString();
    return email.toLowerCase().endsWith("@nebchile.cl") ? email : null;
  } catch {
    return null;
  }
}
