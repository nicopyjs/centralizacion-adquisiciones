import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Acceso simple a la Gestión de Pedidos: usuario fijo ("Adquisiciones") y una
 * sola contraseña. La sesión es una cookie httpOnly firmada con HMAC.
 *
 * Variables de entorno (opcionales):
 *  - GESTION_PASSWORD        : contraseña (por defecto "adq2026")
 *  - GESTION_SESSION_SECRET  : secreto para firmar la cookie (por defecto se
 *                              deriva de la contraseña; al cambiarla, las
 *                              sesiones abiertas dejan de valer)
 */

export const GESTION_USUARIO = "Adquisiciones";
export const SESSION_COOKIE = "gestion_session";
export const SESSION_SECONDS = 60 * 60 * 12; // 12 horas

function password(): string {
  return process.env.GESTION_PASSWORD || "adq2026";
}

function secret(): string {
  return process.env.GESTION_SESSION_SECRET || `gestion:${password()}`;
}

function firmar(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function iguales(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function passwordCorrecta(intento: unknown): boolean {
  return typeof intento === "string" && iguales(intento, password());
}

/** Token con vencimiento: `<expira en ms>.<firma>`. */
export function crearToken(): string {
  const exp = String(Date.now() + SESSION_SECONDS * 1000);
  return `${exp}.${firmar(exp)}`;
}

function tokenValido(token: string | undefined): boolean {
  if (!token) return false;
  const [exp, firma] = token.split(".");
  if (!exp || !firma || !iguales(firma, firmar(exp))) return false;
  return Number(exp) > Date.now();
}

/** ¿La petición actual trae una sesión válida de Adquisiciones? */
export async function haySesion(): Promise<boolean> {
  const store = await cookies();
  return tokenValido(store.get(SESSION_COOKIE)?.value);
}
