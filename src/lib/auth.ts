import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Acceso por perfil. El perfil sale del correo @nebchile.cl con que se inicia
 * sesión en Google (ver `src/lib/usuarios.ts`); no hay contraseñas. La sesión
 * es una cookie httpOnly firmada con HMAC que lleva el perfil.
 *
 * Perfiles:
 *  - adquisiciones : gestiona los pedidos (Gestión de Pedidos, con edición)
 *  - supervisor    : consulta los pedidos de su área (solo lectura)
 *  - maestro       : igual que supervisor
 *
 * Supervisor y maestro inician sesión eligiendo además un área (Refacciones,
 * Servicio Técnico, Instalaciones, Transición y Postventa) y solo ven los
 * pedidos de esa área; el filtro se aplica en el servidor.
 *
 * Variable de entorno:
 *  - GESTION_SESSION_SECRET  : secreto para firmar la cookie. Al cambiarlo, las
 *                              sesiones abiertas dejan de valer.
 */

export type Perfil = "adquisiciones" | "supervisor" | "maestro";
/** adquisiciones edita todo; solicitante (supervisor/maestro) solo consulta. */
export type Rol = "adquisiciones" | "solicitante";

export const PERFILES: { id: Perfil; label: string }[] = [
  { id: "adquisiciones", label: "Adquisiciones" },
  { id: "supervisor", label: "Supervisor" },
  { id: "maestro", label: "Maestro" },
];

export type Area =
  | "refacciones"
  | "servicio-tecnico"
  | "instalaciones"
  | "transicion-postventa";

/** `label` es el valor guardado en la columna "Área" de la hoja Pedidos. */
export const AREAS: { id: Area; label: string }[] = [
  { id: "refacciones", label: "Refacciones" },
  { id: "servicio-tecnico", label: "Servicio Técnico" },
  { id: "instalaciones", label: "Instalaciones" },
  { id: "transicion-postventa", label: "Transición y Postventa" },
];

export function esArea(v: unknown): v is Area {
  return AREAS.some((a) => a.id === v);
}

export function areaLabel(area: Area): string {
  return AREAS.find((a) => a.id === area)?.label ?? area;
}

/** Sesión: perfil + área (solo supervisor/maestro; Adquisiciones ve todo). */
export type Sesion = { perfil: Perfil; area: Area | null };

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

function secret(): string {
  // Mismo valor por defecto que antes (así no se cierran las sesiones abiertas);
  // en producción conviene definir GESTION_SESSION_SECRET.
  return process.env.GESTION_SESSION_SECRET || "gestion:adq2026";
}

function firmar(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function iguales(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Token con vencimiento: `<perfil>.<área o "-">.<expira en ms>.<firma>`. */
export function crearToken(perfil: Perfil, area: Area | null): string {
  const payload = `${perfil}.${area ?? "-"}.${Date.now() + SESSION_SECONDS * 1000}`;
  return `${payload}.${firmar(payload)}`;
}

function sesionDeToken(token: string | undefined): Sesion | null {
  if (!token) return null;
  const [perfil, area, exp, firma] = token.split(".");
  if (!esPerfil(perfil) || !area || !exp || !firma) return null;
  if (!iguales(firma, firmar(`${perfil}.${area}.${exp}`))) return null;
  if (Number(exp) <= Date.now()) return null;
  if (perfil === "adquisiciones") return { perfil, area: null };
  return esArea(area) ? { perfil, area } : null;
}

/** Sesión actual, o null si no hay sesión válida. */
export async function getSesion(): Promise<Sesion | null> {
  const store = await cookies();
  return sesionDeToken(store.get(SESSION_COOKIE)?.value);
}

/** Perfil de la sesión actual, o null si no hay sesión válida. */
export async function getPerfil(): Promise<Perfil | null> {
  return (await getSesion())?.perfil ?? null;
}

/** ¿La petición actual trae una sesión válida de Adquisiciones? */
export async function haySesion(): Promise<boolean> {
  return (await getPerfil()) === "adquisiciones";
}
