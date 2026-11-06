import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import {
  AVISO_RECEPCION,
  ambienteDefontana,
  crearConsumoInterno,
  problemasPorRecibir,
  problemasRecepcion,
  recepcionOC,
  recepcionarOC,
} from "@/lib/defontana";
import { yaConsumido, yaRecepcionado } from "@/lib/marcas-inventario";
import {
  articulosSheetId,
  batchWriteRanges,
  readRange,
} from "@/lib/google-sheets";

const PEDIDOS_SHEET = "Pedidos";

type Accion = "rec_ci" | "rec" | "ci";
const ACCIONES: Accion[] = ["rec_ci", "rec", "ci"];

const str = (v: unknown) => (typeof v === "string" ? v.trim() : String(v ?? "").trim());

/**
 * Flujo de inventario en Defontana para artículos ya recibidos de un pedido;
 * deja los folios en la columna «Consumo interno».
 *
 * Body: { pedidoId, bodega, accion, oc, lineas: [{ fila, cantidad }] }
 *  - rec_ci : recepciona la OC (total o parcial; genera el parte de entrada) y
 *             enseguida hace el consumo interno de lo recepcionado. Exige OC.
 *  - rec    : solo recepciona la OC (el material queda en stock). Exige OC.
 *  - ci     : consumo interno de stock existente; la OC es opcional y, si se
 *             indica, debe estar recepcionada.
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
  const conRecepcion = accion !== "ci";
  const conConsumo = accion !== "rec";
  const ocTexto = str(body.oc);
  const ocNumero = ocTexto === "" ? undefined : Number(ocTexto);
  if (
    ocNumero !== undefined &&
    (!Number.isInteger(ocNumero) || ocNumero <= 0 || ocNumero > 99_999_999)
  ) {
    return NextResponse.json(
      { error: "El N° de OC debe ser un número entero." },
      { status: 400 }
    );
  }
  if (conRecepcion && ocNumero === undefined) {
    return NextResponse.json(
      { error: "Indica el N° de OC que vas a recepcionar." },
      { status: 400 }
    );
  }
  const pedidas: { fila?: unknown; cantidad?: unknown }[] = Array.isArray(body.lineas)
    ? body.lineas
    : [];
  const lineas = pedidas.map((l) => ({
    fila: Number(l?.fila),
    cantidad: Number(l?.cantidad),
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
        l.cantidad <= 0
    ) ||
    new Set(lineas.map((l) => l.fila)).size !== lineas.length
  ) {
    return NextResponse.json({ error: "Líneas inválidas." }, { status: 400 });
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
      codigo: string;
      nombre: string;
      previo: string;
      /** Línea de servicio: se recepciona pero no entra a stock ni se consume. */
      servicio: boolean;
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
      const marca = str(row[17]);
      // Los topes descuentan lo ya recepcionado / consumido desde aquí: evita
      // duplicar con doble clic y permite hacerlo en partes.
      const porConsumir = recibida - yaConsumido(marca);
      const porRecepcionar = recibida - yaRecepcionado(marca);
      const tope = Math.min(
        conConsumo ? porConsumir : Infinity,
        conRecepcion ? porRecepcionar : Infinity
      );
      if (l.cantidad > tope) {
        return NextResponse.json(
          {
            error:
              tope <= 0
                ? `«${nombre}» ya está ${conRecepcion && porRecepcionar <= 0 ? "recepcionado" : "consumido"} por completo (${marca}).`
                : `«${nombre}»: solo quedan ${tope} disponibles (recibido ${recibida}).`,
          },
          { status: tope <= 0 ? 409 : 400 }
        );
      }
      detalle.push({
        ...l,
        codigo: str(row[11]),
        nombre,
        previo: marca,
        servicio: false,
      });
    }

    const cabecera = delPedido[0];
    const centro = str(cabecera[5]);
    if (conConsumo && !centro) {
      return NextResponse.json(
        { error: "El pedido no tiene código de centro de negocio." },
        { status: 400 }
      );
    }

    // Lectura de la OC: para recepcionar (exige cantidades válidas) o para
    // exigir, en el consumo suelto, que ya esté recepcionada.
    const oc = ocNumero !== undefined ? await recepcionOC(ocNumero) : null;
    if (ocNumero !== undefined && !oc) {
      return NextResponse.json(
        { error: `La OC ${ocNumero} no existe en Defontana.` },
        { status: 400 }
      );
    }
    const pedido = detalle.map((d) => ({
      codigo: d.codigo,
      nombre: d.nombre,
      cantidad: d.cantidad,
    }));
    if (oc && conRecepcion) {
      const problemas = problemasPorRecibir(oc, pedido);
      if (problemas.length > 0) {
        return NextResponse.json(
          { error: `OC ${oc.numero}: ${problemas.join("; ")}.` },
          { status: 409 }
        );
      }
      for (const d of detalle) {
        d.servicio = oc.lineas.find((x) => x.codigo === d.codigo)?.servicio === true;
      }
    } else if (oc && accion === "ci") {
      const problemas = problemasRecepcion(oc, pedido);
      if (problemas.length > 0) {
        return NextResponse.json(
          { error: `OC ${oc.numero}: ${problemas.join("; ")}. ${AVISO_RECEPCION}` },
          { status: 409 }
        );
      }
    }

    const fecha = new Date().toLocaleDateString("sv-SE", {
      timeZone: "America/Santiago",
    });
    const glosa = [pedidoId, str(cabecera[15])].filter(Boolean).join(" - ").slice(0, 200);
    const anotaciones = new Map<number, string>(detalle.map((d) => [d.fila, d.previo]));
    const anotar = (
      filas: typeof detalle,
      marcaDe: (d: (typeof detalle)[number]) => string
    ) => {
      for (const d of filas) {
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

    let folioRecepcion: number | undefined;
    let partes: number[] = [];
    if (conRecepcion && oc) {
      const r = await recepcionarOC({
        oc,
        bodega,
        lineas: detalle.map((d) => ({ codigo: d.codigo, cantidad: d.cantidad })),
      });
      folioRecepcion = r.recepcion;
      partes = r.partes;
      const etiqueta = `REC-${r.recepcion}${partes.length ? `/PE-${partes.join("+")}` : ""}`;
      anotar(detalle, (d) => `${etiqueta} (${d.cantidad} · ${bodega})`);
      // Se anota ya: si luego falla el consumo, la recepción queda registrada.
      try {
        await escribir();
      } catch {
        return NextResponse.json(
          {
            error: `La OC SÍ se recepcionó en Defontana (${etiqueta}) pero no se pudo anotar en la planilla. Anótalo a mano en «Consumo interno»; no la recepciones de nuevo.${conConsumo ? " El consumo interno NO se hizo." : ""}`,
            folio: r.recepcion,
          },
          { status: 500 }
        );
      }
    }

    // Servicios: se recepcionan pero no tienen stock que consumir.
    const aConsumir = conConsumo ? detalle.filter((d) => !d.servicio) : [];
    const omitidos = conConsumo ? detalle.filter((d) => d.servicio) : [];
    let folioConsumo: number | undefined;
    if (aConsumir.length > 0) {
      try {
        const externalId = `${pedidoId}-${Date.now().toString(36)}`;
        // Recién recepcionada, el stock tarda unos segundos en reflejarse: se
        // reintenta mientras Defontana diga que no hay saldo.
        for (let intento = 0; ; intento++) {
          try {
            const { folio } = await crearConsumoInterno({
              externalId,
              fecha,
              glosa,
              bodega,
              centroNegocio: centro,
              ocNumero,
              lineas: aConsumir.map((d) => ({
                articleId: d.codigo,
                cantidad: d.cantidad,
              })),
            });
            folioConsumo = folio;
            break;
          } catch (e) {
            const sinSaldo = e instanceof Error && /saldo suficiente/i.test(e.message);
            if (!(conRecepcion && sinSaldo) || intento >= 7) throw e;
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        return NextResponse.json(
          {
            error: folioRecepcion
              ? `La OC SÍ se recepcionó (REC-${folioRecepcion}), pero el consumo interno falló: ${message} Recarga y hazlo con «Solo consumo interno»; no recepciones de nuevo.`
              : message,
            ...(folioRecepcion ? { folio: folioRecepcion } : {}),
          },
          { status: 502 }
        );
      }
      anotar(aConsumir, (d) => `CI-${folioConsumo} (${d.cantidad} · ${bodega})`);
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
      folioRecepcion,
      partes,
      folioConsumo,
      serviciosSinConsumo: omitidos.map((d) => d.nombre),
      ambiente: ambienteDefontana(),
      lineas: detalle.map((d) => ({
        fila: d.fila,
        consumoInterno: anotaciones.get(d.fila) ?? "",
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
