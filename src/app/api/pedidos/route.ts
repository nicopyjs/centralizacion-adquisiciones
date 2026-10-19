import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import {
  appendRows,
  articulosSheetId,
  ensureSheet,
  getSpreadsheetMeta,
  readRange,
  writeRange,
} from "@/lib/google-sheets";

const PEDIDOS_SHEET = "Pedidos";
const HEADERS = [
  "Pedido ID",
  "Fecha",
  "Solicitante",
  "Área",
  "Centro de negocio",
  "Centro Código",
  "Fecha entrega",
  "Clasificador 1",
  "Clasificador 2",
  "Despacho",
  "Categoría",
  "Código",
  "Artículo",
  "Unidad",
  "Cantidad",
  "Comentario",
  "Cantidad recibida",
  "Consumo interno",
  "Recepcionado por",
  "Urgente",
  "Fecha recepción bodega",
  "Fecha entrega solicitante",
  "Comentario artículo",
];
// Última columna de encabezados (23 columnas -> A..W).
const HEADERS_RANGE = `${PEDIDOS_SHEET}!A1:W1`;
// Rango de datos (sin encabezado).
const DATA_RANGE = `${PEDIDOS_SHEET}!A2:W`;

// Prefijos de centro de negocio -> prefijo del folio del pedido (igual al
// prefijo de área usado en EnviarPedidoForm: RCT, SST, INT).
const PREFIJOS_FOLIO = ["RCT", "SST", "INT", "TYP"];

/** Prefijo del folio a partir del código de centro (p. ej. "RCTA25008..." -> "RCT"). */
function prefijoFolio(centroCodigo: string): string {
  const cod = centroCodigo.toUpperCase();
  const match = PREFIJOS_FOLIO.find((p) => cod.startsWith(p));
  return match ?? "PED";
}

/**
 * Siguiente folio correlativo para un prefijo (p. ej. "RCT-1", "RCT-2", …).
 * Se calcula leyendo los folios ya usados en la columna A y tomando el mayor
 * número visto para ese prefijo, +1. Pedidos antiguos con formato
 * "PED-<timestamp>" no matchean el patrón y simplemente se ignoran.
 */
async function siguienteFolio(sheetId: string, prefijo: string): Promise<string> {
  const col = await readRange(sheetId, `${PEDIDOS_SHEET}!A2:A`);
  const patron = new RegExp(`^${prefijo}-(\\d+)$`);
  let max = 0;
  for (const row of col) {
    const m = patron.exec(str(row[0]));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefijo}-${max + 1}`;
}

/** Fecha de hoy en horario local como "YYYY-MM-DD" (formato de <input type="date">). */
function hoyYMD(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** "" o "YYYY-MM-DD" válido. */
function fechaValida(s: string): boolean {
  return s === "" || /^\d{4}-\d{2}-\d{2}$/.test(s);
}

type ItemInput = {
  codigo?: unknown;
  nombre?: unknown;
  categoria?: unknown;
  unidad?: unknown;
  cantidad?: unknown;
  comentario?: unknown;
};

type PedidoInput = {
  solicitante?: unknown;
  area?: { label?: unknown; email?: unknown } | null;
  centroNegocio?: { codigo?: unknown; descripcion?: unknown } | null;
  fechaEntrega?: unknown;
  clasificador1?: unknown;
  clasificador2?: unknown;
  despacho?: unknown;
  comentario?: unknown;
  urgente?: unknown;
  items?: unknown;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

let encabezadosVerificados = false;

function noAutorizado() {
  return NextResponse.json({ error: "No autorizado." }, { status: 401 });
}

async function asegurarPedidosSheet(sheetId: string) {
  const meta = await getSpreadsheetMeta(sheetId);
  const exists = meta.sheets.some((s) => s.properties.title === PEDIDOS_SHEET);

  if (!exists) {
    await ensureSheet(sheetId, PEDIDOS_SHEET);
    await appendRows(sheetId, PEDIDOS_SHEET, [HEADERS]);
    return;
  }

  // Asegura que la fila de encabezados esté al día.
  const firstRow = await readRange(sheetId, HEADERS_RANGE);
  const current = firstRow[0] ?? [];
  const matches =
    current.length === HEADERS.length &&
    HEADERS.every((h, i) => (current[i] ?? "") === h);
  if (!matches) {
    await writeRange(sheetId, HEADERS_RANGE, [HEADERS]);
  }
}

export async function POST(request: Request) {
  let body: PedidoInput;
  try {
    body = (await request.json()) as PedidoInput;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const solicitante = str(body.solicitante);
  const area = str(body.area?.label);
  const centroCodigo = str(body.centroNegocio?.codigo);
  const centroDescripcion = str(body.centroNegocio?.descripcion);
  const fechaEntrega = str(body.fechaEntrega);
  const clasificador1 = str(body.clasificador1);
  const clasificador2 = str(body.clasificador2);
  let despacho = str(body.despacho);
  const comentario = str(body.comentario);
  const esUrgente = body.urgente === true;
  // En la planilla: "Sí" si es urgente, vacío si no.
  const urgente = esUrgente ? "Sí" : "";
  // Red de seguridad del lado del servidor: un pedido urgente siempre se
  // retira directo (no pasa por despacho de proveedor/logística).
  if (esUrgente) despacho = "RETIRA SOLICITANTE";
  const rawItems = Array.isArray(body.items) ? (body.items as ItemInput[]) : [];

  if (!solicitante) {
    return NextResponse.json(
      { error: "El campo 'solicitante' es obligatorio." },
      { status: 400 }
    );
  }

  if (!centroCodigo || !centroDescripcion) {
    return NextResponse.json(
      { error: "Debes seleccionar un centro de negocio." },
      { status: 400 }
    );
  }

  if (!clasificador1 || !clasificador2) {
    return NextResponse.json(
      { error: "Clasificador 1 y Clasificador 2 son obligatorios." },
      { status: 400 }
    );
  }

  const items = rawItems
    .map((it) => ({
      codigo: str(it.codigo),
      nombre: str(it.nombre),
      categoria: str(it.categoria),
      unidad: str(it.unidad) || "UN",
      cantidad: Number(it.cantidad),
      comentario: str(it.comentario),
    }))
    .filter((it) => it.codigo && Number.isFinite(it.cantidad) && it.cantidad > 0);

  if (items.length === 0) {
    return NextResponse.json(
      { error: "El pedido debe tener al menos un artículo con cantidad válida." },
      { status: 400 }
    );
  }

  const sheetId = articulosSheetId();

  try {
    await asegurarPedidosSheet(sheetId);

    const pedidoId = await siguienteFolio(sheetId, prefijoFolio(centroCodigo));
    const fecha = new Date().toISOString();

    const rows = items.map((it) => [
      pedidoId,
      fecha,
      solicitante,
      area,
      centroDescripcion,
      centroCodigo,
      fechaEntrega,
      clasificador1,
      clasificador2,
      despacho,
      it.categoria,
      it.codigo,
      it.nombre,
      it.unidad,
      it.cantidad,
      comentario,
      "",
      "",
      "",
      urgente,
      "", // Fecha recepción bodega
      "", // Fecha entrega solicitante
      it.comentario, // Comentario artículo
    ]);

    await appendRows(sheetId, PEDIDOS_SHEET, rows);

    return NextResponse.json({ ok: true, pedidoId, lineas: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export type PedidoItem = {
  fila: number;
  categoria: string;
  codigo: string;
  nombre: string;
  unidad: string;
  cantidad: number;
  cantidadRecibida: number | null;
  consumoInterno: string;
  recepcionadoPor: string;
  /** Fecha en que el pedido llega a bodega de Adquisiciones ("YYYY-MM-DD"). Editable. */
  fechaRecepcionBodega: string;
  /** Fecha en que se entrega al solicitante/supervisor ("YYYY-MM-DD"). Editable. */
  fechaEntregaSolicitante: string;
  /** Comentario/detalle propio de este artículo, escrito al armar el pedido. */
  comentarioArticulo: string;
};

export type PedidoResumen = {
  pedidoId: string;
  fecha: string;
  solicitante: string;
  area: string;
  centroNegocio: string;
  centroCodigo: string;
  fechaEntrega: string;
  clasificador1: string;
  clasificador2: string;
  despacho: string;
  comentario: string;
  urgente: boolean;
  items: PedidoItem[];
};

export async function GET() {
  if (!(await haySesion())) return noAutorizado();
  const sheetId = articulosSheetId();
  try {
    const meta = await getSpreadsheetMeta(sheetId);
    const exists = meta.sheets.some((s) => s.properties.title === PEDIDOS_SHEET);
    if (!exists) {
      return NextResponse.json({ pedidos: [] });
    }

    const rows = await readRange(sheetId, DATA_RANGE);
    const porPedido = new Map<string, PedidoResumen>();

    rows.forEach((row, i) => {
      const pedidoId = str(row[0]);
      if (!pedidoId) return;
      const fila = i + 2; // +2: encabezado en fila 1, datos desde fila 2.

      let pedido = porPedido.get(pedidoId);
      if (!pedido) {
        pedido = {
          pedidoId,
          fecha: str(row[1]),
          solicitante: str(row[2]),
          area: str(row[3]),
          centroNegocio: str(row[4]),
          centroCodigo: str(row[5]),
          fechaEntrega: str(row[6]),
          clasificador1: str(row[7]),
          clasificador2: str(row[8]),
          despacho: str(row[9]),
          comentario: str(row[15]),
          // Los pedidos anteriores a esta columna quedan como no urgentes.
          urgente: ["si", "sí", "s", "1", "true", "urgente"].includes(
            str(row[19]).toLowerCase()
          ),
          items: [],
        };
        porPedido.set(pedidoId, pedido);
      }

      const cantidadRecibidaRaw = str(row[16]);
      pedido.items.push({
        fila,
        categoria: str(row[10]),
        codigo: str(row[11]),
        nombre: str(row[12]),
        unidad: str(row[13]),
        cantidad: Number(row[14]) || 0,
        cantidadRecibida:
          cantidadRecibidaRaw === "" ? null : Number(cantidadRecibidaRaw),
        consumoInterno: str(row[17]),
        recepcionadoPor: str(row[18]),
        fechaRecepcionBodega: str(row[20]),
        fechaEntregaSolicitante: str(row[21]),
        comentarioArticulo: str(row[22]),
      });
    });

    const pedidos = Array.from(porPedido.values()).sort((a, b) =>
      b.fecha.localeCompare(a.fecha)
    );

    return NextResponse.json({ pedidos });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type PatchInput = {
  fila?: unknown;
  cantidadRecibida?: unknown;
  consumoInterno?: unknown;
  recepcionadoPor?: unknown;
  /** "YYYY-MM-DD" o "" para borrarla. Si no viene, no se toca (salvo auto-relleno). */
  fechaRecepcionBodega?: unknown;
  /** "YYYY-MM-DD" o "" para borrarla. Si no viene, no se toca (salvo auto-relleno). */
  fechaEntregaSolicitante?: unknown;
};

export async function PATCH(request: Request) {
  if (!(await haySesion())) return noAutorizado();
  let body: PatchInput;
  try {
    body = (await request.json()) as PatchInput;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const fila = Number(body.fila);
  if (!Number.isInteger(fila) || fila < 2) {
    return NextResponse.json(
      { error: "El campo 'fila' es inválido." },
      { status: 400 }
    );
  }

  const sheetId = articulosSheetId();

  try {
    // Una vez por instancia: pone al día la fila de encabezados (p. ej. el
    // renombre de «Parte de entrada» a «Recepcionado por») sin esperar a que
    // se registre un pedido nuevo.
    if (!encabezadosVerificados) {
      await asegurarPedidosSheet(sheetId);
      encabezadosVerificados = true;
    }

    // Lee los valores actuales de la fila para no pisar los campos que no
    // vienen en este PATCH (se guarda de a un campo o de a varios). Incluye
    // T (Urgente, para no perderlo al reescribir el bloque) y U/V (las dos
    // fechas, para saber si ya estaban registradas).
    const actual = await readRange(sheetId, `${PEDIDOS_SHEET}!Q${fila}:V${fila}`);
    const [
      curRecibida = "",
      curConsumo = "",
      curRecepcion = "",
      curUrgente = "",
      curFechaBodega = "",
      curFechaSolicitante = "",
    ] = actual[0] ?? [];

    const cantidadRecibida =
      body.cantidadRecibida === undefined
        ? curRecibida
        : body.cantidadRecibida === null || body.cantidadRecibida === ""
          ? ""
          : Number(body.cantidadRecibida);
    const consumoInterno =
      body.consumoInterno === undefined ? curConsumo : str(body.consumoInterno);
    const recepcionadoPor =
      body.recepcionadoPor === undefined ? curRecepcion : str(body.recepcionadoPor);

    if (
      typeof cantidadRecibida === "number" &&
      !Number.isFinite(cantidadRecibida)
    ) {
      return NextResponse.json(
        { error: "La cantidad recibida debe ser un número." },
        { status: 400 }
      );
    }

    // Las dos fechas del KPI de cumplimiento son editables desde el panel:
    // 1) cuándo llega el pedido a bodega de Adquisiciones.
    // 2) cuándo se le entrega al solicitante/supervisor.
    // Si el PATCH trae la fecha explícita (el usuario la tipeó o la borró en
    // el campo de fecha), esa manda. Si no viene, pero sí viene la cantidad
    // recibida / el nombre de quien recepcionó por primera vez, se rellena
    // sola con la fecha de hoy como comodidad (y se puede corregir después).
    let fechaRecepcionBodega = str(curFechaBodega);
    if (body.fechaRecepcionBodega !== undefined) {
      fechaRecepcionBodega = str(body.fechaRecepcionBodega);
    } else if (
      body.cantidadRecibida !== undefined &&
      cantidadRecibida !== "" &&
      !fechaRecepcionBodega
    ) {
      fechaRecepcionBodega = hoyYMD();
    }

    let fechaEntregaSolicitante = str(curFechaSolicitante);
    if (body.fechaEntregaSolicitante !== undefined) {
      fechaEntregaSolicitante = str(body.fechaEntregaSolicitante);
    } else if (
      body.recepcionadoPor !== undefined &&
      recepcionadoPor !== "" &&
      !fechaEntregaSolicitante
    ) {
      fechaEntregaSolicitante = hoyYMD();
    }

    if (!fechaValida(fechaRecepcionBodega) || !fechaValida(fechaEntregaSolicitante)) {
      return NextResponse.json(
        { error: "Fecha inválida (debe ser AAAA-MM-DD)." },
        { status: 400 }
      );
    }

    await writeRange(sheetId, `${PEDIDOS_SHEET}!Q${fila}:V${fila}`, [
      [
        cantidadRecibida,
        consumoInterno,
        recepcionadoPor,
        curUrgente,
        fechaRecepcionBodega,
        fechaEntregaSolicitante,
      ],
    ]);

    return NextResponse.json({
      ok: true,
      fechaRecepcionBodega,
      fechaEntregaSolicitante,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
