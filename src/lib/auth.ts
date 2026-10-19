import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Acceso por perfil, con una contraseña fija por perfil. La sesión es una
 * cookie httpOnly firmada con HMAC que lleva el perfil.
 *
 * Perfiles:
 *  - adquisiciones : gestiona los pedidos (Gestión de Pedidos, con edición)
 *  - supervisor    : consulta sus pedidos (Mis Pedidos, solo lectura)
 *  - maestro       : igual que supervisor
 *
 * Variables de entorno (opcionales):
 *  - GESTION_PASSWORD        : contraseña de Adquisiciones (por defecto "adq2026")
 *  - SUPERVISOR_PASSWORD     : contraseña de Supervisor (por defecto "sup2026")
 *  - MAESTRO_PASSWORD        : contraseña de Maestro (por defecto "mae2026")
 *  - GESTION_SESSION_SECRET  : secreto para firmar la cookie (por defecto se
 *                              deriva de la contraseña de Adquisiciones; al
 *                              cambiarla, las sesiones abiertas dejan de valer)
 */

export type Perfil = "adquisiciones" | "supervisor" | "maestro";
/** adquisiciones edita todo; solicitante (supervisor/maestro) solo consulta. */
export type Rol = "adquisiciones" | "solicitante";

export const PERFILES: { id: Perfil; label: string }[] = [
  { id: "adquisiciones", label: "Adquisiciones" },
  { id: "supervisor", label: "Supervisor" },
  { id: "maestro", label: "Maestro" },
];

export const SESSION_COOKIE = "gestion_session";
export const SESSION_SECONDS = 60 * 60 * 12; // 12 horas

export function perfilLabel(perfil: Perfil): string {
  return PERFILES.find((p) => p.id === perfil)?.label ?? perfil;
}

export function rolDe(perfil: Perfil): Rol {
  return perfil === "adquisiciones" ? "adquisiciones" : "solicitante";
}

export function esPerfil(v: unknown): v is Perfil {
  return PERFILES.some((p) => p.id === v);
}

function passwordDe(perfil: Perfil): string {
  switch (perfil) {
    case "adquisiciones":
      return process.env.GESTION_PASSWORD || "adq2026";
    case "supervisor":
      return process.env.SUPERVISOR_PASSWORD || "sup2026";
    case "maestro":
      return process.env.MAESTRO_PASSWORD || "mae2026";
  }
}

function secret(): string {
  return (
    process.env.GESTION_SESSION_SECRET ||
    `gestion:${process.env.GESTION_PASSWORD || "adq2026"}`
  );
}

function firmar(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function iguales(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function passwordCorrecta(perfil: Perfil, intento: unknown): boolean {
  return typeof intento === "string" && iguales(intento, passwordDe(perfil));
}

/** Token con vencimiento: `<perfil>.<expira en ms>.<firma>`. */
export function crearToken(perfil: Perfil): string {
  const payload = `${perfil}.${Date.now() + SESSION_SECONDS * 1000}`;
  return `${payload}.${firmar(payload)}`;
}

function perfilDeToken(token: string | undefined): Perfil | null {
  if (!token) return null;
  const [perfil, exp, firma] = token.split(".");
  if (!esPerfil(perfil) || !exp || !firma) return null;
  if (!iguales(firma, firmar(`${perfil}.${exp}`))) return null;
  return Number(exp) > Date.now() ? perfil : null;
}

/** Perfil de la sesión actual, o null si no hay sesión válida. */
export async function getPerfil(): Promise<Perfil | null> {
  const store = await cookies();
  return perfilDeToken(store.get(SESSION_COOKIE)?.value);
}

/** ¿La petición actual trae una sesión válida de Adquisiciones? */
export async function haySesion(): Promise<boolean> {
  return (await getPerfil()) === "adquisiciones";
}
