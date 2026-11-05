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
    const d = data as {
      title?: string;
      errors?: Record<string, string[]>;
      exceptionMessage?: string | null;
    };
    const det = d.errors
      ? Object.values(d.errors).flat().join(" ")
      : (d.exceptionMessage || d.title || "");
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

const POR_PAGINA_STOCK = 250; // máximo que acepta GetStorageStock

type PaginaStock = {
  success: boolean;
  message?: string;
  totalItems?: number;
  productList?: { productID: string; stock: number }[];
};

function paginaStock(bodega: string, pagina: number) {
  return llamar<PaginaStock>(
    `/api/Sale/GetStorageStock?storageID=${encodeURIComponent(bodega)}&itemsPerPage=${POR_PAGINA_STOCK}&pageNumber=${pagina}`
  );
}

/**
 * Stock de los artículos pedidos en cada bodega activa:
 * { BC14: { AICA0081: 10, ... }, ... }. Un artículo que la bodega no lista
 * queda en 0. Recorre las páginas de cada bodega en paralelo.
 */
export async function stockPorBodega(
  codigos: string[]
): Promise<Record<string, Record<string, number>>> {
  const clave = `${ambienteDefontana()}:${[...codigos].sort().join(",")}`;
  const hit = cacheStock.get(clave);
  if (hit && Date.now() - hit.t < 60_000) return hit.v;
  const v = await calcularStock(codigos);
  cacheStock.set(clave, { t: Date.now(), v });
  if (cacheStock.size > 50) cacheStock.delete(cacheStock.keys().next().value!);
  return v;
}

// Caché corto: el stock es orientativo (Defontana lo valida al registrar) y
// recorrer las bodegas grandes tarda unos segundos.
const cacheStock = new Map<
  string,
  { t: number; v: Record<string, Record<string, number>> }
>();

async function calcularStock(
  codigos: string[]
): Promise<Record<string, Record<string, number>>> {
  const buscados = new Set(codigos);
  const bodegas = await listarBodegas();
  const resultado: Record<string, Record<string, number>> = {};
  await Promise.all(
    bodegas.map(async (b) => {
      const stock: Record<string, number> = Object.fromEntries(
        codigos.map((c) => [c, 0])
      );
      const recoger = (p: PaginaStock) => {
        if (!p.success) throw new Error(p.message || "No se pudo leer el stock.");
        for (const x of p.productList ?? []) {
          if (buscados.has(x.productID)) stock[x.productID] = Number(x.stock) || 0;
        }
      };
      const primera = await paginaStock(b.codigo, 1);
      recoger(primera);
      const paginas = Math.ceil((primera.totalItems ?? 0) / POR_PAGINA_STOCK);
      const resto = await Promise.all(
        Array.from({ length: Math.max(0, paginas - 1) }, (_, i) =>
          paginaStock(b.codigo, i + 2)
        )
      );
      resto.forEach(recoger);
      resultado[b.codigo] = stock;
    })
  );
  return resultado;
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

export type LineaOC = { codigo: string; pedida: number; recibida: number };

/**
 * Lee una OC de Defontana y cuánto se ha recepcionado de cada línea (la
 * recepción genera el parte de entrada que sube el stock). Devuelve null si la
 * OC no existe.
 */
export async function recepcionOC(
  numero: number
): Promise<{ numero: number; estado: string; lineas: LineaOC[] } | null> {
  try {
    const r = await llamar<{
      success: boolean;
      purchaseOrderData?: {
        receiptState?: string;
        purchaseOrderDetail?: {
          productId: string;
          quantity: number;
          receivedQuantity: number;
        }[];
      } | null;
    }>(`/api/PurchaseOrder/Get?Number=${numero}`);
    const o = r.purchaseOrderData;
    if (!r.success || !o) return null;
    return {
      numero,
      estado: o.receiptState ?? "",
      lineas: (o.purchaseOrderDetail ?? []).map((d) => ({
        codigo: d.productId,
        pedida: Number(d.quantity) || 0,
        recibida: Number(d.receivedQuantity) || 0,
      })),
    };
  } catch (e) {
    if (e instanceof Error && /no existe/i.test(e.message)) return null;
    throw e;
  }
}

/**
 * Motivos por los que no se puede consumir contra la OC: el artículo no está
 * en la OC o aún no se recepcionó (sin parte de entrada no hay stock).
 */
export function problemasRecepcion(
  oc: { lineas: LineaOC[] },
  pedido: { codigo: string; nombre: string; cantidad: number }[]
): string[] {
  const out: string[] = [];
  for (const p of pedido) {
    const lineas = oc.lineas.filter((l) => l.codigo === p.codigo);
    if (lineas.length === 0) {
      out.push(`«${p.nombre}» no está en la OC`);
      continue;
    }
    const recibida = lineas.reduce((a, l) => a + l.recibida, 0);
    if (recibida <= 0) out.push(`«${p.nombre}» aún no está recepcionado en la OC`);
    else if (recibida < p.cantidad)
      out.push(`«${p.nombre}»: la OC tiene recepcionado ${recibida} y pides ${p.cantidad}`);
  }
  return out;
}

export const AVISO_RECEPCION =
  "Entra a Defontana, recepciona la OC (genera el parte de entrada que sube el stock) y vuelve a intentarlo.";

export type ParteEntradaInput = {
  /** PE = a inventario (Mercaderías); PE_CD = directo al gasto del centro. */
  tipo: "PE" | "PE_CD";
  externalId: string;
  /** "YYYY-MM-DD" */
  fecha: string;
  glosa: string;
  bodega: string;
  centroNegocio: string;
  /** costo: unitario neto de compra. */
  lineas: { articleId: string; cantidad: number; costo: number }[];
};

/**
 * Crea un parte de entrada (sube el stock de la bodega). Contablemente debita
 * Mercaderías (PE) o el gasto de la categoría con el centro (PE_CD) y acredita
 * «Facturas por recibir». Devuelve el folio.
 */
export async function crearParteEntrada(
  input: ParteEntradaInput
): Promise<{ folio: number; tipo: string }> {
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
      documentTypeId: input.tipo,
      fiscalYear: input.fecha.slice(0, 4),
      gloss: input.glosa,
      reasonId: "COMPRA",
      destinationStowageId: input.bodega,
      date: input.fecha,
      externalDocumentID: input.externalId,
      analysis,
      details: input.lineas.map((l) => ({
        articleId: l.articleId,
        count: l.cantidad,
        price: l.costo,
        comment: "",
        analysis,
      })),
    },
  });
  if (!r.success || !r.number) {
    throw new Error(
      r.exceptionMessage || r.message || "Defontana rechazó el parte de entrada."
    );
  }
  return { folio: r.number, tipo: r.documentType ?? input.tipo };
}
