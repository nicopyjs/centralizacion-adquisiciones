import { Redis } from "@upstash/redis";
import { areaLabel, perfilLabel, rolDe, type Rol, type Sesion } from "@/lib/auth";

/**
 * Chat por pedido entre los solicitantes de un área (supervisor / maestro) y
 * Adquisiciones. Los mensajes viven en Redis (Upstash) y los archivos en Drive.
 *
 * Claves:
 *  - chat:msgs:<folio>      lista de mensajes (JSON)
 *  - chat:area:<folio>      área del pedido (para autorizar sin leer el Sheet)
 *  - chat:unread:adq        hash folio → mensajes de solicitantes sin leer por Adquisiciones
 *  - chat:unread:sol:<área> hash folio → mensajes de Adquisiciones sin leer por esa área
 */

export type Adjunto = { id: string; nombre: string; mime: string; size: number };

export type Mensaje = {
  id: string;
  rol: Rol;
  autor: string;
  texto: string;
  ts: number;
  adjuntos: Adjunto[];
};

export const MAX_TEXTO = 2000;
export const MAX_MENSAJES = 300;
export const MAX_ARCHIVOS = 3;
/** Vercel limita el cuerpo de una función a ~4,5 MB. */
export const MAX_BYTES_TOTAL = 4 * 1024 * 1024;

let redis: Redis | null = null;
export function db(): Redis {
  if (!redis) redis = Redis.fromEnv();
  return redis;
}

const kMsgs = (folio: string) => `chat:msgs:${folio}`;
const kArea = (folio: string) => `chat:area:${folio}`;
const kNoLeidosAdq = "chat:unread:adq";
const kNoLeidosSol = (area: string) => `chat:unread:sol:${area}`;

export const normArea = (label: string) => label.trim().toLowerCase();

export type Acceso = { rol: Rol; area: string | null };

/** Rol y área de la sesión, o null si no puede usar el chat. */
export function accesoDe(sesion: Sesion | null): Acceso | null {
  if (!sesion) return null;
  const rol = rolDe(sesion.perfil);
  if (rol === "adquisiciones") return { rol, area: null };
  return sesion.area ? { rol, area: normArea(areaLabel(sesion.area)) } : null;
}

export function autorDe(sesion: Sesion): string {
  if (sesion.perfil === "adquisiciones") return "Adquisiciones";
  const area = sesion.area ? ` · ${areaLabel(sesion.area)}` : "";
  return `${perfilLabel(sesion.perfil)}${area}`;
}

/** ¿Puede este acceso ver el hilo de un pedido de esa área? */
export function puedeVer(acceso: Acceso, areaPedido: string | null): boolean {
  if (acceso.rol === "adquisiciones") return true;
  return areaPedido !== null && acceso.area === areaPedido;
}

export async function areaDelHilo(folio: string): Promise<string | null> {
  return (await db().get<string>(kArea(folio))) ?? null;
}

export async function leerMensajes(folio: string): Promise<Mensaje[]> {
  return (await db().lrange<Mensaje>(kMsgs(folio), -MAX_MENSAJES, -1)) ?? [];
}

/** Marca el hilo como leído para quien lo está mirando. */
export async function marcarLeido(folio: string, acceso: Acceso): Promise<void> {
  if (acceso.rol === "adquisiciones") await db().hdel(kNoLeidosAdq, folio);
  else if (acceso.area) await db().hdel(kNoLeidosSol(acceso.area), folio);
}

export async function agregarMensaje(
  folio: string,
  areaPedido: string,
  msg: Mensaje
): Promise<void> {
  const r = db();
  await r.set(kArea(folio), areaPedido);
  await r.rpush(kMsgs(folio), msg);
  // El mensaje queda sin leer para la contraparte.
  if (msg.rol === "adquisiciones") await r.hincrby(kNoLeidosSol(areaPedido), folio, 1);
  else await r.hincrby(kNoLeidosAdq, folio, 1);
}

/** folio → cantidad de mensajes sin leer para este acceso. */
export async function noLeidos(acceso: Acceso): Promise<Record<string, number>> {
  const clave =
    acceso.rol === "adquisiciones"
      ? kNoLeidosAdq
      : acceso.area
        ? kNoLeidosSol(acceso.area)
        : null;
  if (!clave) return {};
  const h = (await db().hgetall<Record<string, number | string>>(clave)) ?? {};
  const out: Record<string, number> = {};
  for (const [folio, n] of Object.entries(h)) {
    const c = Number(n);
    if (c > 0) out[folio] = c;
  }
  return out;
}

/** Nombre de archivo seguro para Drive y para cabeceras HTTP. */
export function limpiarNombre(nombre: string): string {
  const n = nombre.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 120);
  return n || "archivo";
}
