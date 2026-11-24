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

/**
 * Los clasificadores del pedido se guardan como "05 INT - Instalaciones";
 * Defontana guarda solo el código ("05"). Mandar el texto completo hace fallar
 * el guardado del encabezado ("An error occurred while saving the entity
 * changes"): reproducido en `replapi` el 2026-11-13 con el pedido INT-34.
 */
export function codigoClasificador(valor: string | undefined): string {
  return (valor ?? "").trim().split(/\s+/)[0] ?? "";
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
  /**
   * N° de la factura electrónica de compra (opcional). Si viene, es el
   * documento de referencia del parte (como al recepcionar en el ERP) y
   * reemplaza a la OC en esa referencia: el documento admite una sola.
   */
  facturaNumero?: number;
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
 * `facturaNumero` se manda como referencia con tipo `FCA` (verificado en
 * `replapi` el 2026-11-13: Defontana lo guarda en `referenceDocumentType`/
 * `referenceDocumentFolio`; con `Cpra_FCA` responde error).
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
  const c1 = codigoClasificador(input.clasificador1);
  const c2 = codigoClasificador(input.clasificador2);
  const analysis = {
    businessCenter: input.centroNegocio,
    ...(c1 ? { clasifier1: c1 } : {}),
    ...(c2 ? { clasifier2: c2 } : {}),
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
      ...(input.facturaNumero
        ? { referenceDocumentFolio: input.facturaNumero, referenceDocumentType: "FCA" }
        : input.ocNumero
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
      `${r.exceptionMessage || r.message || "Defontana rechazó el parte de entrada."} ` +
        `(centro ${input.centroNegocio}, clasificadores ${c1 || "-"}/${c2 || "-"}, bodega ${input.bodega})`
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
  /** "YYYY-MM-DD" */
  fecha: string;
  /** Estado como lo muestra Defontana en el listado: Aprobado, Parcialmente Recepcionado… */
  estadoTexto: string;
  /** Campo personalizado «Código Pedido» de la OC, si Defontana lo trae. */
  codigoPedido: string;
  lineas: LineaOC[];
};

/** Estados de OC a los que se puede asociar un pedido (regla de Adquisiciones). */
export const ESTADOS_OC_ASOCIABLES = ["Aprobado", "Parcialmente Recepcionado"];

/**
 * Estado en texto a partir de los códigos de PurchaseOrder/Get (verificado en
 * `replapi` el 2026-11-23 contra el estado del listado): Ingresado = aprobación
 * pendiente (approveState PC); Anulado = emissionState N; Cerrado = emissionState
 * C (billingState NO sirve: una OC facturada y aún sin recepcionar trae C y sigue
 * «Aprobado», p. ej. la 4753; verificado contra producción el 2026-11-24); si no, según lo recepcionado (receiptState P / I / C).
 */
export function estadoTextoOC(o: {
  approveState?: string;
  receiptState?: string;
  billingState?: string;
  emissionState?: string;
}): string {
  if (o.emissionState === "N") return "Anulado";
  if (o.approveState !== "AC") return "Ingresado";
  if (o.emissionState === "C") return "Cerrado";
  if (o.receiptState === "C") return "Completamente Recepcionado";
  if (o.receiptState === "I") return "Parcialmente Recepcionado";
  return "Aprobado";
}

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
        approveState?: string;
        billingState?: string;
        emissionState?: string;
        emissionDate?: string;
        customFields?: { name?: string; value?: string }[] | null;
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
      fecha: (o.emissionDate ?? "").slice(0, 10),
      estadoTexto: estadoTextoOC(o),
      codigoPedido:
        (o.customFields ?? [])
          .find((c) => /^c[oó]digo\s*pedido$/i.test((c.name ?? "").trim()))
          ?.value?.trim() ?? "",
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

export type OCListada = {
  numero: number;
  proveedor: string;
  rut: string;
  /** "YYYY-MM-DD" */
  fecha: string;
  estado: string;
  total: string;
};

/**
 * OC de un proveedor (por nombre o RUT) de los últimos 12 meses, de la más
 * reciente a la más antigua. `PurchaseOrder/List` filtra por
 * `ProviderNameOrLegalCode` (verificado en `replapi` el 2026-11-23).
 */
export async function buscarOCsDeProveedor(texto: string): Promise<OCListada[]> {
  const hoy = new Date();
  const desde = new Date(hoy.getTime() - 365 * 864e5);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const out: OCListada[] = [];
  for (let pagina = 0; pagina < 4; pagina++) {
    const r = await llamar<{
      success: boolean;
      message?: string | null;
      totalItems?: number;
      data?: {
        number: number;
        providerName: string;
        providerLegalCode: string;
        emissionDate: string;
        status: string;
        totalLocalCurrency: string;
      }[];
    }>(
      `/api/PurchaseOrder/List?FromDate=${ymd(desde)}&ToDate=${ymd(hoy)}&ItemsPerPage=100&Page=${pagina}&Status=0&ProviderNameOrLegalCode=${encodeURIComponent(texto)}`
    );
    if (!r.success) throw new Error(r.message || "No se pudieron leer las OC.");
    for (const o of r.data ?? []) {
      out.push({
        numero: o.number,
        proveedor: o.providerName,
        rut: o.providerLegalCode,
        fecha: (o.emissionDate ?? "").slice(0, 10),
        estado: o.status,
        total: o.totalLocalCurrency,
      });
    }
    if ((r.data?.length ?? 0) < 100) break;
  }
  return out.sort((a, b) => b.numero - a.numero);
}

export type CondicionPago = { codigo: string; nombre: string };

/** Catálogo de condiciones de pago (Sale/GetPaymentConditions, verificado en `replapi` el 2026-11-24). */
export async function condicionesPago(): Promise<CondicionPago[]> {
  const r = await llamar<{
    success: boolean;
    message?: string | null;
    items?: { code: string; name: string }[] | null;
  }>("/api/Sale/GetPaymentConditions");
  if (!r.success) throw new Error(r.message || "No se pudieron leer las condiciones de pago.");
  return (r.items ?? []).map((c) => ({ codigo: c.code, nombre: c.name }));
}

export type ProveedorDefontana = {
  /** RUT con puntos y guion: es el `providerID` que pide InsertPurchaseOrder. */
  rut: string;
  nombre: string;
  /** Condición de pago asociada al proveedor en Defontana ("" si no tiene). */
  condicionPago: string;
};

/**
 * Proveedores activos por nombre o RUT (PurchaseOrder/GetProviders, verificado en
 * `replapi` el 2026-11-24: `description` busca por nombre, `legalCode` por RUT
 * exacto con puntos y guion). La condición de pago del proveedor viene en
 * `purchase[0].paymentConditionId`.
 */
export async function buscarProveedores(texto: string): Promise<ProveedorDefontana[]> {
  const t = texto.trim();
  const filtro = /^\d[\d.\-kK]*$/.test(t)
    ? `legalCode=${encodeURIComponent(formatearRut(t))}`
    : `description=${encodeURIComponent(t)}`;
  const r = await llamar<{
    success: boolean;
    message?: string | null;
    providersList?: {
      legalCode: string;
      name: string;
      purchase?: { paymentConditionId?: string | null }[] | null;
    }[];
  }>(`/api/PurchaseOrder/GetProviders?${filtro}&status=1&itemsPerPage=20&pageNumber=0`);
  if (!r.success) throw new Error(r.message || "No se pudieron leer los proveedores.");
  return (r.providersList ?? []).map((p) => ({
    rut: p.legalCode,
    nombre: p.name,
    condicionPago: p.purchase?.[0]?.paymentConditionId ?? "",
  }));
}

/** Despacho de las OC de NEB (el mismo que trae el ERP al crear una OC a mano). */
const DESPACHO_NEB = {
  dispatchContact: "990767096",
  dispatchPhone: "990767096",
  dispatchAddress: "Padre Mariano 391 of 203",
  dispatchDistrict: "PROVIDENCIA",
  dispatchState: "REGION METROPOLITANA",
  dispatchCity: "Santiago",
  dispatchCountry: "CL",
};

/**
 * "06 RCT - Refacciones de Central Térmica" → "06RCT", como guarda Defontana el
 * clasificador en las OC creadas a mano (verificado en la OC 4753).
 */
export function clasificadorOC(valor: string | undefined): string {
  return (valor ?? "").split(" - ")[0].replace(/\s+/g, "");
}

export type CrearOCInput = {
  proveedorRut: string;
  centroNegocio: string;
  condicionPago: string;
  /** "YYYY-MM-DD" */
  fechaEmision: string;
  /** "YYYY-MM-DD" */
  fechaRecepcion: string;
  /** OC exenta de IVA (los precios se tratan como monto exento). */
  exenta: boolean;
  comentario: string;
  codigoPedido: string;
  clasificador1?: string;
  clasificador2?: string;
  /** `precio` es el neto unitario en pesos. */
  lineas: { codigo: string; cantidad: number; precio: number; comentario?: string }[];
};

/**
 * Crea una OC (PurchaseOrder/InsertPurchaseOrder, contrato del Swagger
 * "Main API v1"; probado en `replapi` el 2026-11-24). Queda en «Ingresado»
 * (approveState PC): alguien la aprueba en Defontana.
 *
 * Campos personalizados: «Código Pedido» se acepta. Clasificador 1/2 los
 * rechaza `replapi` con «excede el máximo permitido de 0 caracteres» (el campo
 * no tiene largo configurado en Defontana) y a nivel de línea se ignoran en
 * silencio. Por eso, si Defontana rechaza un campo personalizado por nombre, se
 * reintenta sin él y se devuelve en `omitidos` para que se complete a mano.
 */
export async function crearOC(
  input: CrearOCInput
): Promise<{ numero: number; omitidos: string[] }> {
  const details = input.lineas.map((l) => ({
    isService: false,
    productID: l.codigo,
    quantity: l.cantidad,
    price: l.precio,
    total: Math.round(l.cantidad * l.precio),
    discount: 0,
    comment: l.comentario ?? "",
    customFields: [],
  }));
  const neto = details.reduce((a, d) => a + d.total, 0);
  const iva = input.exenta ? 0 : Math.round(neto * 0.19);
  const c1 = clasificadorOC(input.clasificador1);
  const c2 = clasificadorOC(input.clasificador2);
  let customFields = [
    { name: "Código Pedido", value: input.codigoPedido },
    ...(c1 ? [{ name: "Clasificador 1", value: c1 }] : []),
    ...(c2 ? [{ name: "Clasificador 2", value: c2 }] : []),
  ];
  const omitidos: string[] = [];
  const dia = (ymd: string) => `${ymd}T00:00:00`;

  for (let intento = 0; intento < 5; intento++) {
    const r = await llamar<{
      number?: string | number | null;
      success: boolean;
      message?: string | null;
      exceptionMessage?: string | null;
    }>("/api/PurchaseOrder/InsertPurchaseOrder", {
      method: "POST",
      body: {
        providerID: input.proveedorRut,
        businessCenter: input.centroNegocio,
        coinID: "PESO",
        paymentCondition: input.condicionPago,
        // Factura de compra electrónica: el tipo que trae el proveedor y el ERP.
        documentTypeId: "FCA",
        exchangeRate: 1,
        emissionDate: dia(input.fechaEmision),
        expirationDate: dia(input.fechaEmision),
        receiptDate: dia(input.fechaRecepcion),
        amountBeforeTaxes: input.exenta ? 0 : neto,
        modifiers: 0,
        amountExempt: input.exenta ? neto : 0,
        taxes: iva,
        amountTotal: neto + iva,
        details,
        ...DESPACHO_NEB,
        comment: input.comentario,
        customFields,
        taxesOC: input.exenta ? [] : [{ code: "IVA", percentage: 19, value: iva }],
      },
    });
    const numero = Number(r.number);
    if (r.success && numero) return { numero, omitidos };
    const msg = r.exceptionMessage || r.message || "Defontana rechazó la OC.";
    const campo = /campo(?: personalizado)? '([^']+)'/.exec(msg)?.[1];
    if (campo && customFields.some((c) => c.name === campo) && campo !== "Código Pedido") {
      omitidos.push(campo);
      customFields = customFields.filter((c) => c.name !== campo);
      continue;
    }
    throw new Error(msg);
  }
  throw new Error("Defontana rechazó los campos personalizados de la OC.");
}

/** Código con el que la planilla de pedidos guarda un artículo que no está en el catálogo. */
export const CODIGO_ARTICULO_MANUAL = "MANUAL";

export type CategoriaArticulo = { id: number; nombre: string };
export type UnidadArticulo = { codigo: string; nombre: string };

/** Categorías de artículos (Sale/GetCategories; en `replapi` hay 68, tipo "A" = artículo). */
export async function categoriasArticulo(): Promise<CategoriaArticulo[]> {
  const r = await llamar<{
    success: boolean;
    message?: string | null;
    categoriesList?: { categoryID: number; description: string; type?: string }[] | null;
  }>("/api/Sale/GetCategories?itemsPerPage=200&pageNumber=0");
  if (!r.success) throw new Error(r.message || "No se pudieron leer las categorías.");
  const lista = r.categoriesList ?? [];
  return lista
    .filter((c) => (c.type ?? "A") === "A")
    .map((c) => ({ id: c.categoryID, nombre: c.description }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Unidades de medida (Sale/GetUnits). Defontana acepta cualquier texto al crear un artículo, por eso se valida contra este catálogo. */
export async function unidadesArticulo(): Promise<UnidadArticulo[]> {
  const r = await llamar<{
    success: boolean;
    message?: string | null;
    unitList?: { code: string; description: string }[] | null;
  }>("/api/Sale/GetUnits?itemsPerPage=100&pageNumber=0");
  if (!r.success) throw new Error(r.message || "No se pudieron leer las unidades.");
  return (r.unitList ?? []).map((u) => ({ codigo: u.code, nombre: u.description }));
}

/**
 * Prefijo de código por categoría y último correlativo conocido de cada prefijo
 * (medido en Defontana el 2026-11-24). NEB codifica los artículos como
 * 4 letras + 4 dígitos (CACU0014); varias categorías comparten prefijo, por eso
 * el correlativo es por prefijo. Es solo el punto de partida: `crearArticulo`
 * sigue subiendo mientras Defontana responda «ya existe».
 */
const CODIGO_POR_CATEGORIA: Record<number, [prefijo: string, ultimo: number]> = {
  1: ["ESAC", 6], 2: ["ACAC", 33], 3: ["ACEQ", 49], 4: ["AICA", 106], 5: ["AIPX", 20],
  6: ["BBAC", 4], 7: ["BBEQ", 125], 8: ["BBRP", 5], 9: ["CDAC", 63], 10: ["CDEQ", 9],
  11: ["CDRP", 52], 12: ["CACU", 19], 13: ["CAFE", 20], 14: ["CAPX", 4], 15: ["CAPR", 38],
  16: ["CAPV", 10], 17: ["COCL", 13], 18: ["ELCO", 22], 19: ["ELGN", 288], 20: ["ELTA", 2],
  21: ["EPEQ", 3], 22: ["EPGN", 116], 23: ["EPRO", 83], 24: ["EXEQ", 56], 25: ["FJGN", 280],
  26: ["FIBR", 156], 27: ["FICU", 214], 28: ["FIFE", 183], 29: ["FIGV", 83], 30: ["FINX", 24],
  31: ["FIPX", 123], 32: ["FIPR", 179], 33: ["FIPV", 85], 34: ["FIRN", 68], 35: ["HEEL", 50],
  36: ["HEIN", 31], 37: ["HEMA", 193], 38: ["HEOM", 5], 39: ["ITAA", 13], 40: ["ITGN", 363],
  41: ["ITOF", 57], 42: ["ICAC", 29], 43: ["ICEQ", 9], 44: ["MECD", 7], 45: ["RAAC", 8],
  46: ["RAEQ", 57], 47: ["SUCE", 5], 48: ["SUMD", 3], 49: ["VABO", 30], 50: ["VAGL", 17],
  51: ["VAIC", 112], 52: ["VAMP", 13], 53: ["VAMO", 21], 54: ["VEAC", 24], 55: ["VECS", 60],
  56: ["VECF", 14], 57: ["VEDU", 38], 58: ["VEEQ", 85], 59: ["VEIV", 51], 60: ["VETM", 2],
  62: ["TAEQ", 4], 63: ["TAEQ", 4], 64: ["AREQ", 1], 65: ["ARVE", 1], 66: ["ARMA", 1],
  67: ["ESAE", 6], 68: ["TEIF", 2], 69: ["SECO", 2],
};

/**
 * Crea un artículo en Defontana (Sale/SaveProduct, probado en `replapi` el
 * 2026-11-24) con el siguiente código libre de su categoría. Devuelve el código.
 * Un código repetido responde `success:false` «ya existe» (no sobrescribe).
 */
export async function crearArticulo(input: {
  nombre: string;
  unidad: string;
  categoriaId: number;
  /** Precio de compra neto (solo informativo en el maestro). */
  precio?: number;
}): Promise<string> {
  const base = CODIGO_POR_CATEGORIA[input.categoriaId];
  if (!base) {
    throw new Error(`La categoría ${input.categoriaId} no tiene prefijo de código definido.`);
  }
  const [prefijo, ultimo] = base;
  for (let n = ultimo + 1; n <= ultimo + 40; n++) {
    const codigo = `${prefijo}${String(n).padStart(4, "0")}`;
    const r = await llamar<{
      success: boolean;
      message?: string | null;
      exceptionMessage?: string | null;
    }>("/api/Sale/SaveProduct", {
      method: "POST",
      body: {
        code: codigo,
        name: input.nombre.trim().toUpperCase(),
        unit: input.unidad,
        price: input.precio ?? 0,
        description: "",
        categoryID: input.categoriaId,
        isService: false,
        usaLotes: false,
      },
    });
    if (r.success) return codigo;
    const msg = r.exceptionMessage || r.message || "";
    if (/ya existe/i.test(msg)) continue;
    throw new Error(msg || "Defontana rechazó la creación del artículo.");
  }
  throw new Error(`No se encontró un código libre para el prefijo ${prefijo}.`);
}
