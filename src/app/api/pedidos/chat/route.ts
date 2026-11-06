import { NextResponse } from "next/server";
import { getSesion } from "@/lib/auth";
import {
  MAX_ARCHIVOS,
  MAX_BYTES_TOTAL,
  MAX_TEXTO,
  accesoDe,
  agregarMensaje,
  areaDelHilo,
  autorDe,
  leerMensajes,
  limpiarNombre,
  marcarLeido,
  normArea,
  puedeVer,
  type Adjunto,
  type Mensaje,
} from "@/lib/chat";
import { carpetaDePedido, subirArchivo } from "@/lib/drive";
import { articulosSheetId, readRange } from "@/lib/google-sheets";

export const maxDuration = 60;

/** Mensajes de un pedido. Abrir el hilo lo marca como leído para quien lo mira. */
export async function GET(request: Request) {
  const acceso = accesoDe(await getSesion());
  if (!acceso) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const folio = (new URL(request.url).searchParams.get("folio") ?? "").trim();
  if (!folio) return NextResponse.json({ error: "Falta el folio." }, { status: 400 });

  try {
    const area = await areaDelHilo(folio);
    // Sin mensajes todavía: no hay hilo (ni área registrada) que proteger.
    if (area === null) return NextResponse.json({ mensajes: [] });
    if (!puedeVer(acceso, area)) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
    // ?solo=lectura: ver fotos/adjuntos sin marcar el hilo como leído.
    const soloLectura = new URL(request.url).searchParams.get("solo") === "lectura";
    const [mensajes] = await Promise.all([
      leerMensajes(folio),
      soloLectura ? Promise.resolve() : marcarLeido(folio, acceso),
    ]);
    return NextResponse.json({ mensajes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Envía un mensaje (multipart: folio, texto, archivo*). */
export async function POST(request: Request) {
  const sesion = await getSesion();
  const acceso = accesoDe(sesion);
  if (!sesion || !acceso) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const folio = String(form.get("folio") ?? "").trim();
  const texto = String(form.get("texto") ?? "").trim();
  const archivos = form.getAll("archivo").filter((f): f is File => f instanceof File && f.size > 0);

  if (!folio) return NextResponse.json({ error: "Falta el folio." }, { status: 400 });
  if (!texto && archivos.length === 0) {
    return NextResponse.json({ error: "Escribe un mensaje o adjunta un archivo." }, { status: 400 });
  }
  if (texto.length > MAX_TEXTO) {
    return NextResponse.json(
      { error: `El mensaje admite hasta ${MAX_TEXTO} caracteres.` },
      { status: 400 }
    );
  }
  if (archivos.length > MAX_ARCHIVOS) {
    return NextResponse.json(
      { error: `Máximo ${MAX_ARCHIVOS} archivos por mensaje.` },
      { status: 400 }
    );
  }
  if (archivos.reduce((s, f) => s + f.size, 0) > MAX_BYTES_TOTAL) {
    return NextResponse.json(
      { error: "Los archivos superan el máximo de 4 MB por mensaje." },
      { status: 413 }
    );
  }

  try {
    // El pedido debe existir; su área define quién puede ver el hilo.
    const pedidos = await readRange(articulosSheetId(), "Pedidos!A2:D");
    const fila = pedidos.find((r) => (r[0] ?? "").trim() === folio);
    if (!fila) return NextResponse.json({ error: `El pedido ${folio} no existe.` }, { status: 400 });
    const areaPedido = normArea(fila[3] ?? "");
    if (!puedeVer(acceso, areaPedido)) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const adjuntos: Adjunto[] = [];
    if (archivos.length > 0) {
      const carpeta = await carpetaDePedido(folio);
      for (const f of archivos) {
        const nombre = limpiarNombre(f.name);
        const mime = f.type || "application/octet-stream";
        const id = await subirArchivo(carpeta, nombre, mime, Buffer.from(await f.arrayBuffer()));
        adjuntos.push({ id, nombre, mime, size: f.size });
      }
    }

    const msg: Mensaje = {
      id: crypto.randomUUID(),
      rol: acceso.rol,
      autor: autorDe(sesion),
      texto,
      ts: Date.now(),
      adjuntos,
    };
    await agregarMensaje(folio, areaPedido, msg);
    return NextResponse.json({ ok: true, mensaje: msg });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
