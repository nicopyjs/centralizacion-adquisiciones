/**
 * Cliente mínimo de la API de Defontana (solo lo que usa esta app: bodegas y
 * consumo interno).
 *
 * Variables de entorno:
 *  - DEFONTANA_TOKEN    : JWT de integración.
 *  - DEFONTANA_AMBIENTE : "pruebas" (por defecto, https://replapi.defontana.com)
 *                         o "produccion" (https://api.defontana.com). Producción
 *                         hay que pedirla explícitamente.
 */

export type Ambiente = "pruebas" | "produccion";

export function ambienteDefontana(): Ambiente {
  return process.env.DEFONTANA_AMBIENTE === "produccion" ? "produccion" : "pruebas";
}

function baseUrl(): string {
  return ambienteDefontana() === "produccion"
    ? "https://api.defontana.com"
    : "https://replapi.defontana.com";
}

async function llamar<T>(
  path: string,
  init?: { method: "POST"; body: unknown }
): Promise<T> {
  const token = process.env.DEFONTANA_TOKEN;
  if (!token) throw new Error("Falta la variable de entorno DEFONTANA_TOKEN.");
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init ? { "Content-Type": "application/json" } : {}),
      },
      body: init ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new Error("No se pudo conectar con Defontana (sin respuesta). Reintenta.");
  }
  if (res.status === 401) {
    throw new Error("El token de Defontana venció o no es válido (401). Hay que renovarlo.");
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Defontana respondió HTTP ${res.status} con un formato inesperado.`);
  }
  if (!res.ok) {
    const d = data as { title?: string; errors?: Record<string, string[]> };
    const det = d.errors ? Object.values(d.errors).flat().join(" ") : (d.title ?? "");
    throw new Error(`Defontana respondió HTTP ${res.status}. ${det}`.trim());
  }
  return data as T;
}

export type Bodega = { codigo: string; nombre: string };

export async function listarBodegas(): Promise<Bodega[]> {
  const r = await llamar<{
    success: boolean;
    message?: string;
    storageList?: { code: string; description: string; active: string }[];
  }>("/api/Sale/GetStorages?itemsPerPage=100&pageNumber=1");
  if (!r.success) throw new Error(r.message || "No se pudieron leer las bodegas.");
  return (r.storageList ?? [])
    .filter((b) => b.active === "S")
    .map((b) => ({ codigo: b.code, nombre: b.description }));
}

export type ConsumoInternoInput = {
  /** ID externo para ubicar el documento (folio del pedido + sufijo). */
  externalId: string;
  /** "YYYY-MM-DD" */
  fecha: string;
  glosa: string;
  bodega: string;
  centroNegocio: string;
  /** N° de la OC asociada (opcional); se manda como documento de referencia. */
  ocNumero?: number;
  lineas: { articleId: string; cantidad: number; comentario?: string }[];
};

/** Crea un documento de inventario CI (consumo interno). Devuelve el folio. */
export async function crearConsumoInterno(
  input: ConsumoInternoInput
): Promise<{ folio: number; tipo: string }> {
  // Los CI que hace contabilidad no llevan clasificadores: solo centro.
  const analysis = { businessCenter: input.centroNegocio };
  const r = await llamar<{
    number?: number;
    documentType?: string;
    success: boolean;
    message?: string | null;
    exceptionMessage?: string | null;
  }>("/api/Inventory/Insert", {
    method: "POST",
    body: {
      documentTypeId: "CI",
      fiscalYear: input.fecha.slice(0, 4),
      gloss: input.glosa,
      reasonId: "SALIDA",
      ...(input.ocNumero
        ? { referenceDocumentFolio: input.ocNumero, referenceDocumentType: "OC_ABA" }
        : {}),
      originStowageId: input.bodega,
      date: input.fecha,
      externalDocumentID: input.externalId,
      analysis,
      details: input.lineas.map((l) => ({
        articleId: l.articleId,
        count: l.cantidad,
        price: 0, // Defontana usa el costo vigente del artículo.
        comment: l.comentario ?? "",
        analysis,
      })),
    },
  });
  if (!r.success || !r.number) {
    throw new Error(
      r.exceptionMessage || r.message || "Defontana rechazó el consumo interno."
    );
  }
  return { folio: r.number, tipo: r.documentType ?? "CI" };
}
