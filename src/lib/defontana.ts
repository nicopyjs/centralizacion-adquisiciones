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

export type ParteEntradaCostoDirectoInput = {
  /** ID externo para ubicar el documento (folio del pedido + sufijo). */
  externalId: string;
  /** "YYYY-MM-DD" */
  fecha: string;
  glosa: string;
  /** Bodega de destino (donde queda el stock). */
  bodega: string;
  centroNegocio: string;
  /** Clasificador 1 y 2 del pedido/OC (campos de análisis del gasto en Defontana). */
  clasificador1?: string;
  clasificador2?: string;
  /** Proveedor de la OC de referencia (si la hay), en formato con puntos/guion. */
  providerId?: string;
  /** N° de OC de referencia (opcional): solo trazabilidad, NO la marca como recepcionada. */
  ocNumero?: number;
  lineas: { articleId: string; cantidad: number; costoUnitario: number; comentario?: string }[];
};

/**
 * Crea un documento de inventario PE_CD (Parte de Entrada Costo Directo):
 * ingresa mercadería a bodega sin una OC detrás, con el costo escrito a mano
 * en cada línea. Devuelve el folio.
 *
 * A diferencia de un PE normal (que sube la cuenta de Mercaderías, activo),
 * un PE_CD imputa el monto directo a la cuenta de gasto de la categoría del
 * artículo — verificado contra `GetAccountingDefinition` en `replapi` el
 * 2026-11-09 (comparando PE / PE_CD / CI). Por eso es un paso único, SIN
 * consumo interno después (ver nota en `src/app/api/pedidos/consumo-interno/route.ts`):
 * y por eso, a diferencia de `recepcionarOC`, aquí SÍ hay que mandar el
 * centro de negocio en `analysis` — nada más lo va a imputar.
 *
 * Probado en `replapi` el 2026-11-09 (folio PE_CD-89, artículo de prueba
 * ACAC0001 en BODEGACENTRAL): Defontana exige el campo `analysis` incluso
 * vacío — sin él responde 400 "Object reference not set to an instance of
 * an object" (NullReferenceException interna), igual que si faltara en
 * `crearConsumoInterno`.
 *
 * `providerId`/`ocNumero` son solo trazabilidad (se mandan como proveedor y
 * `referenceDocumentFolio`/`referenceDocumentType:"OC_ABA"`, igual que hace
 * `crearConsumoInterno`): verificado en `replapi` el 2026-11-11 que la API
 * pública de recepción de OC (`PurchaseOrder/InsertReceptionDocument`) SIEMPRE
 * genera un `PE` normal, nunca un `PE_CD`, sin importar la bodega de destino
 * (se probó contra la bodega "PROYECTOS CD" — código `PROYECTOS` — y generó
 * un PE). El selector "Parte de Entrada Costo Directo" que se ve en
 * `erp.defontana.com` al recepcionar una OC es una función interna del ERP
 * que la API de integración no expone: por eso un PE_CD solo se puede crear
 * por esta vía (`Inventory/Insert`), que NO actualiza el `receivedQuantity`
 * de la OC en Defontana (la OC seguirá viéndose pendiente ahí).
 *
 * `clasificador1`/`clasificador2` se mandan en `analysis` como `clasifier1`/
 * `clasifier2` (verificado en `replapi` el 2026-11-11, folio PE_CD-99:
 * Defontana los guarda tal cual a nivel cabecera y línea) — son los mismos
 * clasificadores de análisis de gasto que trae el pedido/la OC, igual que un
 * PE o CI reales.
 */
export async function crearParteEntradaCostoDirecto(
  input: ParteEntradaCostoDirectoInput
): Promise<{ folio: number; tipo: string }> {
  const analysis = {
    businessCenter: input.centroNegocio,
    ...(input.clasificador1 ? { clasifier1: input.clasificador1 } : {}),
    ...(input.clasificador2 ? { clasifier2: input.clasificador2 } : {}),
  };
  const r = await llamar<{
    number?: number;
    documentType?: string;
    success: boolean;
    message?: string | null;
    exceptionMessage?: string | null;
  }>("/api/Inventory/Insert", {
    method: "POST",
    body: {
      documentTypeId: "PE_CD",
      fiscalYear: input.fecha.slice(0, 4),
      gloss: input.glosa,
      destinationStowageId: input.bodega,
      date: input.fecha,
      externalDocumentID: input.externalId,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.ocNumero
        ? { referenceDocumentFolio: input.ocNumero, referenceDocumentType: "OC_ABA" }
        : {}),
      analysis,
      details: input.lineas.map((l) => ({
        articleId: l.articleId,
        count: l.cantidad,
        price: l.costoUnitario,
        comment: l.comentario ?? "",
        analysis,
      })),
    },
  });
  if (!r.success || !r.number) {
    throw new Error(
      r.exceptionMessage || r.message || "Defontana rechazó el parte de entrada."
    );
  }
  return { folio: r.number, tipo: r.documentType ?? "PE_CD" };
}

/**
 * RUT con puntos y guion (77.949.210-9). PurchaseOrder/Get lo entrega sin
 * puntos, pero la recepción solo reconoce al proveedor con el formato de las
 * listas.
 */
export function formatearRut(rut: string): string {
  const limpio = rut.replace(/[.\s]/g, "").toUpperCase();
  const m = limpio.match(/^(\d+)-?([\dK])$/);
  if (!m) return rut;
  return `${m[1].replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${m[2]}`;
}

export type LineaOC = {
  /** N° de línea dentro de la OC (lo exige la recepción). */
  linea: number;
  codigo: string;
  pedida: number;
  recibida: number;
  /** Monto neto de la línea completa (ya con descuento). */
  monto: number;
  servicio: boolean;
  usaLotes: boolean;
};

export type OrdenCompra = {
  numero: number;
  /** receiptState de Defontana: P pendiente, I parcial, C completa. */
  estado: string;
  serie: string;
  proveedorRut: string;
  proveedorNombre: string;
  lineas: LineaOC[];
};

/**
 * Lee una OC de Defontana con proveedor y cuánto se ha recepcionado de cada
 * línea (la recepción genera el parte de entrada que sube el stock). Devuelve
 * null si la OC no existe.
 */
export async function recepcionOC(numero: number): Promise<OrdenCompra | null> {
  try {
    const r = await llamar<{
      success: boolean;
      purchaseOrderData?: {
        receiptState?: string;
        series?: string | null;
        providerInfo?: { legalCode?: string; name?: string };
        purchaseOrderDetail?: {
          line: number;
          productId: string;
          quantity: number;
          receivedQuantity: number;
          amount: number;
          product?: { isService?: boolean; usesLotes?: boolean } | null;
        }[];
      } | null;
    }>(`/api/PurchaseOrder/Get?Number=${numero}`);
    const o = r.purchaseOrderData;
    if (!r.success || !o) return null;
    return {
      numero,
      estado: o.receiptState ?? "",
      serie: o.series ?? "",
      proveedorRut: formatearRut(o.providerInfo?.legalCode ?? ""),
      proveedorNombre: o.providerInfo?.name ?? "",
      lineas: (o.purchaseOrderDetail ?? []).map((d) => ({
        linea: d.line,
        codigo: d.productId,
        pedida: Number(d.quantity) || 0,
        recibida: Number(d.receivedQuantity) || 0,
        monto: Number(d.amount) || 0,
        servicio: d.product?.isService === true,
        usaLotes: d.product?.usesLotes === true,
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
  "Recepciona la OC desde aquí (opción «Recepcionar OC») o en Defontana, y vuelve a intentarlo.";

/**
 * Problemas para recepcionar estas cantidades contra la OC: el artículo debe
 * estar en la OC, ser entero, caber en lo pendiente y no usar lotes.
 */
export function problemasPorRecibir(
  oc: { lineas: LineaOC[] },
  pedido: { codigo: string; nombre: string; cantidad: number }[]
): string[] {
  const out: string[] = [];
  for (const p of pedido) {
    const l = oc.lineas.find((x) => x.codigo === p.codigo);
    if (!l) {
      out.push(`«${p.nombre}» no está en la OC`);
    } else if (l.usaLotes) {
      out.push(`«${p.nombre}» usa lotes: recepciónalo en Defontana`);
    } else if (!Number.isInteger(p.cantidad)) {
      out.push(`«${p.nombre}»: Defontana solo recepciona cantidades enteras`);
    } else if (p.cantidad > l.pedida - l.recibida) {
      out.push(
        `«${p.nombre}»: en la OC quedan ${l.pedida - l.recibida} por recibir y pides ${p.cantidad}`
      );
    }
  }
  return out;
}

export type RecepcionInput = {
  oc: OrdenCompra;
  bodega: string;
  lineas: { codigo: string; cantidad: number }[];
};

/**
 * Recepciona (total o parcialmente) una OC: Defontana crea el documento de
 * recepción y el parte de entrada ligado a la OC, con el proveedor y el costo
 * de la OC. Devuelve el N° de recepción y los folios de los PE generados.
 */
export async function recepcionarOC(
  input: RecepcionInput
): Promise<{ recepcion: number; partes: number[] }> {
  const { oc } = input;
  const detail = input.lineas.map((l) => {
    const d = oc.lineas.find((x) => x.codigo === l.codigo);
    if (!d) throw new Error(`«${l.codigo}» no está en la OC ${oc.numero}.`);
    return {
      line: d.linea,
      productId: d.codigo,
      quantity: l.cantidad,
      // Costo de la OC proporcional a lo que se recibe.
      total: Math.round((d.monto / d.pedida) * l.cantidad * 100) / 100,
      isService: d.servicio,
    };
  });
  const r = await llamar<{
    number?: string | number | null;
    success: boolean;
    message?: string | null;
    exceptionMessage?: string | null;
  }>("/api/PurchaseOrder/InsertReceptionDocument", {
    method: "POST",
    body: {
      providerId: oc.proveedorRut,
      purchaseOrderNumber: oc.numero,
      // Defontana rechaza la OC si la serie va nula: debe ser "" cuando no hay.
      series: oc.serie ?? "",
      storageCode: input.bodega,
      detail,
    },
  });
  const recepcion = Number(r.number);
  if (!r.success || !recepcion) {
    throw new Error(
      r.exceptionMessage || r.message || "Defontana rechazó la recepción de la OC."
    );
  }
  // El PE lo genera Defontana con un pequeño retraso: se espera a que aparezca
  // para dejar el folio anotado (informativo; la recepción ya está hecha).
  let partes: number[] = [];
  for (let intento = 0; intento < 6 && partes.length === 0; intento++) {
    if (intento > 0) await new Promise((r) => setTimeout(r, 700));
    try {
      const d = await llamar<{
        receptionDocumentList?: {
          receptionDocumentNumber: number;
          inventoryDocumentList?: { numberDocInv: string; docTypeInv: string }[];
        }[];
      }>(`/api/PurchaseOrder/GetReceptionDocuments?Number=${oc.numero}`);
      partes = (d.receptionDocumentList ?? [])
        .filter((x) => x.receptionDocumentNumber === recepcion)
        .flatMap((x) => x.inventoryDocumentList ?? [])
        .filter((x) => x.docTypeInv === "PE")
        .map((x) => Number(x.numberDocInv))
        .filter(Boolean);
    } catch {
      break;
    }
    // Una OC solo de servicios no genera PE: no se espera de más.
    if (detail.every((x) => x.isService)) break;
  }
  return { recepcion, partes };
}
