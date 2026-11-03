import { authHeaders } from "@/lib/google-sheets";

/**
 * Adjuntos del chat en Google Drive. Estructura:
 *   <DRIVE_CHAT_ROOT_ID>/chat de pedidos/<folio>/<archivo>
 * La carpeta raíz debe estar compartida como Editor con la cuenta de servicio.
 */

const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const CARPETA = "application/vnd.google-apps.folder";
export const CARPETA_CHAT = "chat de pedidos";

function rootId(): string {
  const v = process.env.DRIVE_CHAT_ROOT_ID;
  if (!v) throw new Error("Falta la variable de entorno DRIVE_CHAT_ROOT_ID");
  return v;
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function buscarCarpeta(nombre: string, padre: string): Promise<string | null> {
  const q = `name='${esc(nombre)}' and '${padre}' in parents and mimeType='${CARPETA}' and trashed=false`;
  const url = `${FILES}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await fetch(url, { headers: await authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`Drive (buscar carpeta) HTTP ${res.status}`);
  const data = (await res.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

async function crearCarpeta(nombre: string, padre: string): Promise<string> {
  const res = await fetch(`${FILES}?fields=id&supportsAllDrives=true`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ name: nombre, mimeType: CARPETA, parents: [padre] }),
  });
  if (!res.ok) throw new Error(`Drive (crear carpeta) HTTP ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

async function asegurarCarpeta(nombre: string, padre: string): Promise<string> {
  return (await buscarCarpeta(nombre, padre)) ?? (await crearCarpeta(nombre, padre));
}

/** Carpeta del pedido (crea "chat de pedidos" y la del folio si faltan). */
export async function carpetaDePedido(folio: string): Promise<string> {
  const chat = await asegurarCarpeta(CARPETA_CHAT, rootId());
  return asegurarCarpeta(folio, chat);
}

/** Sube un archivo a la carpeta indicada y devuelve su id de Drive. */
export async function subirArchivo(
  carpetaId: string,
  nombre: string,
  mime: string,
  datos: Buffer
): Promise<string> {
  const boundary = `----chat${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name: nombre, parents: [carpetaId] });
  const cuerpo = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`
    ),
    datos,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch(`${UPLOAD}?uploadType=multipart&fields=id&supportsAllDrives=true`, {
    method: "POST",
    headers: {
      ...(await authHeaders()),
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: new Uint8Array(cuerpo),
  });
  if (!res.ok) throw new Error(`Drive (subir archivo) HTTP ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

/** Descarga el contenido de un archivo de Drive (respuesta en streaming). */
export async function descargarArchivo(id: string): Promise<Response> {
  const res = await fetch(`${FILES}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Drive (descargar) HTTP ${res.status}`);
  return res;
}
