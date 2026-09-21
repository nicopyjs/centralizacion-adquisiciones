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
  "Parte de entrada",
  "Urgente",
];
// Última columna de encabezados (20 columnas -> A..T).
const HEADERS_RANGE = `${PEDIDOS_SHEET}!A1:T1`;
// Rango de datos (sin encabezado).
const DATA_RANGE = `${PEDIDOS_SHEET}!A2:T`;

type ItemInput = {
  codigo?: unknown;
  nombre?: unknown;
  categoria?: unknown;
  unidad?: unknown;
  cantidad?: unknown;
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
  const despacho = str(body.despacho);
  const comentario = str(body.comentario);
  // En la planilla: "Sí" si es urgente, vacío si no.
  const urgente = body.urgente === true ? "Sí" : "";
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

  const items = rawItems
    .map((it) => ({
      codigo: str(it.codigo),
      nombre: str(it.nombre),
      categoria: str(it.categoria),
      unidad: str(it.unidad) || "UN",
      cantidad: Number(it.cantidad),
    }))
    .filter((it) => it.codigo && Number.isFinite(it.cantidad) && it.cantidad > 0);

  if (items.length === 0) {
    return NextResponse.json(
      { error: "El pedido debe tener al menos un artículo con cantidad válida." },
      { status: 400 }
    );
  }

  const pedidoId = `PED-${Date.now()}`;
  const fecha = new Date().toISOString();
  const sheetId = articulosSheetId();

  try {
    await asegurarPedidosSheet(sheetId);

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
  parteDeEntrada: string;
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
        parteDeEntrada: str(row[18]),
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
  parteDeEntrada?: unknown;
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
    // Lee los valores actuales de la fila para no pisar los campos que no
    // vienen en este PATCH (se guarda de a un campo o de a varios).
    const actual = await readRange(sheetId, `${PEDIDOS_SHEET}!Q${fila}:S${fila}`);
    const [curRecibida = "", curConsumo = "", curParte = ""] = actual[0] ?? [];

    const cantidadRecibida =
      body.cantidadRecibida === undefined
        ? curRecibida
        : body.cantidadRecibida === null || body.cantidadRecibida === ""
          ? ""
          : Number(body.cantidadRecibida);
    const consumoInterno =
      body.consumoInterno === undefined ? curConsumo : str(body.consumoInterno);
    const parteDeEntrada =
      body.parteDeEntrada === undefined ? curParte : str(body.parteDeEntrada);

    if (
      typeof cantidadRecibida === "number" &&
      !Number.isFinite(cantidadRecibida)
    ) {
      return NextResponse.json(
        { error: "La cantidad recibida debe ser un número." },
        { status: 400 }
      );
    }

    await writeRange(sheetId, `${PEDIDOS_SHEET}!Q${fila}:S${fila}`, [
      [cantidadRecibida, consumoInterno, parteDeEntrada],
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
