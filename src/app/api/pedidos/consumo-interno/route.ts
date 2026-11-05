import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import {
  AVISO_RECEPCION,
  ambienteDefontana,
  crearConsumoInterno,
  crearParteEntrada,
  problemasRecepcion,
  recepcionOC,
} from "@/lib/defontana";
import {
  articulosSheetId,
  batchWriteRanges,
  readRange,
} from "@/lib/google-sheets";

const PEDIDOS_SHEET = "Pedidos";
/** Marcas que se escriben en «Consumo interno» (col. R): "CI-2302", "PE-2047", "PECD-63". */
const CON_CI = /CI-\d+/;
const CON_PE = /PE(?:CD)?-\d+/;
const CON_PECD = /PECD-\d+/;

type Accion = "ci" | "pe_ci" | "pe" | "pe_cd";
const ACCIONES: Accion[] = ["ci", "pe_ci", "pe", "pe_cd"];

const str = (v: unknown) => (typeof v === "string" ? v.trim() : String(v ?? "").trim());

/**
 * Movimientos de inventario en Defontana para artículos ya recepcionados de un
 * pedido; deja los folios en la columna «Consumo interno».
 *
 * Body: { pedidoId, bodega, accion, oc?, lineas: [{ fila, cantidad, costo? }] }
 *  - ci     : consumo interno (baja stock; imputa al centro)
 *  - pe_ci  : parte de entrada a inventario y luego consumo interno
 *  - pe     : solo parte de entrada a inventario
 *  - pe_cd  : parte de entrada a costo directo (gasto del centro; sin CI)
 * Todo lo demás (código de artículo, centro) se lee de la planilla en el
 * servidor, no del cliente.
 */
export async function POST(request: Request) {
  if (!(await haySesion())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  let body: {
    pedidoId?: unknown;
    bodega?: unknown;
    accion?: unknown;
    oc?: unknown;
    lineas?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const pedidoId = str(body.pedidoId);
  const bodega = str(body.bodega);
  const accion = (body.accion ?? "ci") as Accion;
  if (!ACCIONES.includes(accion)) {
    return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  }
  const conEntrada = accion !== "ci";
  const conConsumo = accion === "ci" || accion === "pe_ci";
  // La OC solo aplica al consumo suelto: es la referencia del CI.
  const ocTexto = accion === "ci" ? str(body.oc) : "";
  const ocNumero = ocTexto === "" ? undefined : Number(ocTexto);
  if (
    ocNumero !== undefined &&
    (!Number.isInteger(ocNumero) || ocNumero <= 0 || ocNumero > 99_999_999)
  ) {
    return NextResponse.json(
      { error: "El N° de OC debe ser un número entero (o déjalo vacío)." },
      { status: 400 }
    );
  }
  const pedidas: { fila?: unknown; cantidad?: unknown; costo?: unknown }[] =
    Array.isArray(body.lineas) ? body.lineas : [];
  const lineas = pedidas.map((l) => ({
    fila: Number(l?.fila),
    cantidad: Number(l?.cantidad),
    costo: Number(l?.costo),
  }));
  if (!pedidoId || !bodega || lineas.length === 0 || lineas.length > 100) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  if (
    lineas.some(
      (l) =>
        !Number.isInteger(l.fila) ||
        l.fila < 2 ||
        !Number.isFinite(l.cantidad) ||
        l.cantidad <= 0 ||
        (conEntrada && !(l.costo > 0 && l.costo < 1e10))
    ) ||
    new Set(lineas.map((l) => l.fila)).size !== lineas.length
  ) {
    return NextResponse.json(
      {
        error: conEntrada
          ? "Líneas inválidas: indica cantidad y costo unitario mayores que 0."
          : "Líneas inválidas.",
      },
      { status: 400 }
    );
  }

  try {
    const sheetId = articulosSheetId();
    const rows = await readRange(sheetId, `${PEDIDOS_SHEET}!A2:Y`);
    const delPedido = rows.filter((r) => str(r[0]) === pedidoId);
    if (delPedido.length === 0) {
      return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });
    }
    if (["cerrado", "anulado"].includes(str(delPedido[0][23]).toLowerCase())) {
      return NextResponse.json(
        { error: "El pedido está cerrado o anulado. Reábrelo primero." },
        { status: 409 }
      );
    }

    const detalle: {
      fila: number;
      cantidad: number;
      costo: number;
      codigo: string;
      nombre: string;
      previo: string;
    }[] = [];
    for (const l of lineas) {
      const row = rows[l.fila - 2];
      if (!row || str(row[0]) !== pedidoId) {
        return NextResponse.json(
          { error: "El pedido cambió. Recarga la lista e inténtalo de nuevo." },
          { status: 409 }
        );
      }
      const nombre = str(row[12]);
      const recibida = Number(str(row[16]));
      if (!(recibida > 0)) {
        return NextResponse.json(
          { error: `«${nombre}» aún no tiene cantidad recibida.` },
          { status: 400 }
        );
      }
      if (l.cantidad > recibida) {
        return NextResponse.json(
          { error: `«${nombre}»: la cantidad supera lo recibido (${recibida}).` },
          { status: 400 }
        );
      }
      const marca = str(row[17]);
      if (CON_CI.test(marca)) {
        return NextResponse.json(
          { error: `«${nombre}» ya tiene un consumo interno registrado (${marca}).` },
          { status: 409 }
        );
      }
      if (conEntrada && CON_PE.test(marca)) {
        return NextResponse.json(
          { error: `«${nombre}» ya tiene un parte de entrada registrado (${marca}).` },
          { status: 409 }
        );
      }
      if (conConsumo && CON_PECD.test(marca)) {
        return NextResponse.json(
          {
            error: `«${nombre}» entró a costo directo (${marca}): ya está en el gasto del centro, un consumo interno lo contaría dos veces.`,
          },
          { status: 409 }
        );
      }
      detalle.push({ ...l, codigo: str(row[11]), nombre, previo: marca });
    }

    const cabecera = delPedido[0];
    const centro = str(cabecera[5]);
    if (!centro) {
      return NextResponse.json(
        { error: "El pedido no tiene código de centro de negocio." },
        { status: 400 }
      );
    }

    // Consumo suelto con OC: el material debe estar recepcionado en Defontana
    // (parte de entrada); si no, el stock no existe o no corresponde a la OC.
    if (accion === "ci" && ocNumero !== undefined) {
      const oc = await recepcionOC(ocNumero);
      if (!oc) {
        return NextResponse.json(
          { error: `La OC ${ocNumero} no existe en Defontana.` },
          { status: 400 }
        );
      }
      const problemas = problemasRecepcion(
        oc,
        detalle.map((d) => ({ codigo: d.codigo, nombre: d.nombre, cantidad: d.cantidad }))
      );
      if (problemas.length > 0) {
        return NextResponse.json(
          { error: `OC ${ocNumero}: ${problemas.join("; ")}. ${AVISO_RECEPCION}` },
          { status: 409 }
        );
      }
    }

    const fecha = new Date().toLocaleDateString("sv-SE", {
      timeZone: "America/Santiago",
    });
    const glosa = [pedidoId, str(cabecera[15])].filter(Boolean).join(" - ").slice(0, 200);
    const anotaciones = new Map<number, string>(
      detalle.map((d) => [d.fila, d.previo])
    );
    const anotar = (marcaDe: (d: (typeof detalle)[number]) => string) => {
      for (const d of detalle) {
        anotaciones.set(
          d.fila,
          [anotaciones.get(d.fila), marcaDe(d)].filter(Boolean).join(" | ")
        );
      }
    };
    const escribir = () =>
      batchWriteRanges(
        sheetId,
        detalle.map((d) => ({
          range: `${PEDIDOS_SHEET}!R${d.fila}`,
          values: [[anotaciones.get(d.fila) ?? ""]],
        }))
      );
    const resultado = () =>
      detalle.map((d) => ({ fila: d.fila, consumoInterno: anotaciones.get(d.fila) ?? "" }));

    let folioEntrada: number | undefined;
    if (conEntrada) {
      const tipo = accion === "pe_cd" ? "PE_CD" : "PE";
      const { folio } = await crearParteEntrada({
        tipo,
        externalId: `${pedidoId}-${tipo}-${Date.now().toString(36)}`,
        fecha,
        glosa,
        bodega,
        centroNegocio: centro,
        lineas: detalle.map((d) => ({
          articleId: d.codigo,
          cantidad: d.cantidad,
          costo: d.costo,
        })),
      });
      folioEntrada = folio;
      const prefijo = tipo === "PE_CD" ? "PECD" : "PE";
      anotar((d) => `${prefijo}-${folio} (${d.cantidad} · ${bodega})`);
      // Se anota ya: si luego falla el consumo, el PE queda registrado.
      try {
        await escribir();
      } catch {
        return NextResponse.json(
          {
            error: `El parte de entrada SÍ se creó en Defontana (folio ${prefijo}-${folio}) pero no se pudo anotar en la planilla. Anótalo a mano en «Consumo interno»; no lo registres de nuevo.${conConsumo ? " El consumo interno NO se hizo." : ""}`,
            folio,
          },
          { status: 500 }
        );
      }
    }

    let folioConsumo: number | undefined;
    if (conConsumo) {
      try {
        const { folio } = await crearConsumoInterno({
          externalId: `${pedidoId}-${Date.now().toString(36)}`,
          fecha,
          glosa,
          bodega,
          centroNegocio: centro,
          ocNumero,
          lineas: detalle.map((d) => ({ articleId: d.codigo, cantidad: d.cantidad })),
        });
        folioConsumo = folio;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        return NextResponse.json(
          {
            error: folioEntrada
              ? `El parte de entrada PE-${folioEntrada} SÍ se creó, pero el consumo interno falló: ${message} Recarga y hazlo con «Solo consumo interno»; no repitas la entrada.`
              : message,
            ...(folioEntrada ? { folio: folioEntrada } : {}),
          },
          { status: 502 }
        );
      }
      anotar((d) => `CI-${folioConsumo} (${d.cantidad} · ${bodega})`);
      // El documento ya existe en Defontana: si falla la planilla, el error
      // incluye el folio para no duplicarlo a ciegas.
      try {
        await escribir();
      } catch {
        return NextResponse.json(
          {
            error: `El consumo interno SÍ se creó en Defontana (folio CI-${folioConsumo}) pero no se pudo anotar en la planilla. Anótalo a mano en «Consumo interno»; no lo registres de nuevo.`,
            folio: folioConsumo,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      accion,
      folio: folioConsumo ?? folioEntrada,
      folioEntrada,
      folioConsumo,
      ambiente: ambienteDefontana(),
      lineas: resultado(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
