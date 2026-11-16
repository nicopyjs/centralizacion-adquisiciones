import { NextResponse } from "next/server";
import { carpetaDePedido, iniciarSubidaReanudable } from "@/lib/drive";
import { articulosSheetId, readRange } from "@/lib/google-sheets";
import { getGoogleEmail } from "@/lib/google-oauth";

/** Tope por archivo subido directo a Drive. */
const MAX_BYTES_ARCHIVO = 100 * 1024 * 1024;
const EXT_PERMITIDAS = /\.(pdf|xlsx|xls|csv|docx|doc|png|jpe?g|dwg|dxf|zip)$/i;
const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;

function error(msg: string, status: number) {
  return NextResponse.json({ error: msg }, { status });
}

/**
 * Autoriza la subida de un archivo grande al Drive del pedido. Devuelve la URL
 * de una sesión de subida reanudable; el navegador sube el archivo directo ahí.
 * Body: `{ folio, nombre, mime, size }`. Solo cuentas @nebchile.cl conectadas.
 */
export async function POST(request: Request) {
  if (!(await getGoogleEmail())) {
    return error("Conecta tu cuenta de Google para subir archivos.", 401);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return error("Solicitud inválida.", 400);
  }
  const folio = typeof body.folio === "string" ? body.folio.trim() : "";
  const nombre =
    typeof body.nombre === "string"
      ? body.nombre.replace(/[\r\n"\\/]/g, "_").slice(0, 150)
      : "";
  const size = Number(body.size);
  const mime =
    typeof body.mime === "string" && MIME_RE.test(body.mime)
      ? body.mime
      : "application/octet-stream";
  if (!/^[A-Z]{3}-\d+$/.test(folio)) return error("Folio inválido.", 400);
  if (!nombre || !EXT_PERMITIDAS.test(nombre)) {
    return error(
      "Solo PDF, Excel, Word, CSV, imágenes, planos (DWG/DXF) o ZIP.",
      400
    );
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES_ARCHIVO) {
    return error("Cada archivo puede pesar hasta 100 MB.", 413);
  }

  try {
    const folios = await readRange(articulosSheetId(), "Pedidos!A2:A");
    if (!folios.some((f) => String(f[0] ?? "").trim() === folio)) {
      return error("El pedido no existe en la planilla.", 404);
    }
    const carpeta = await carpetaDePedido(folio);
    const url = await iniciarSubidaReanudable(
      carpeta,
      nombre,
      mime,
      size,
      new URL(request.url).origin
    );
    return NextResponse.json({ url });
  } catch (err) {
    console.error("Subida a Drive falló:", err);
    return error("No se pudo preparar la subida a Drive.", 502);
  }
}
