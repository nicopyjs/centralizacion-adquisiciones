import type { AdjuntoSaliente } from "@/lib/google-oauth";

export const MAX_ARCHIVOS = 3;
/** Vercel limita el cuerpo de una función a ~4,5 MB. */
export const MAX_BYTES_TOTAL = 4 * 1024 * 1024;

const MIMES: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export type ResultadoAdjuntos =
  | { ok: true; adjuntos: AdjuntoSaliente[] }
  | { ok: false; error: string; status: number };

/** Lee y valida los archivos (campo "archivo") de un FormData. */
export async function leerAdjuntos(form: FormData): Promise<ResultadoAdjuntos> {
  const archivos = form
    .getAll("archivo")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (archivos.length > MAX_ARCHIVOS) {
    return { ok: false, error: `Máximo ${MAX_ARCHIVOS} archivos.`, status: 400 };
  }
  if (archivos.reduce((s, f) => s + f.size, 0) > MAX_BYTES_TOTAL) {
    return {
      ok: false,
      error: "Los archivos superan el máximo de 4 MB en total.",
      status: 413,
    };
  }
  const adjuntos: AdjuntoSaliente[] = [];
  for (const f of archivos) {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    const mime = MIMES[ext];
    if (!mime) {
      return {
        ok: false,
        error: `«${f.name}»: solo se pueden adjuntar PDF, Excel, Word, CSV o imágenes.`,
        status: 400,
      };
    }
    adjuntos.push({
      nombre: f.name.replace(/[\r\n"\\/]/g, "_").slice(0, 150),
      mime,
      datos: Buffer.from(await f.arrayBuffer()),
    });
  }
  return { ok: true, adjuntos };
}
