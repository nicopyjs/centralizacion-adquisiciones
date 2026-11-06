import { NextResponse } from "next/server";
import { getSesion } from "@/lib/auth";
import { accesoDe, areaDelHilo, leerMensajes, normArea, puedeVer } from "@/lib/chat";
import { articulosSheetId, readRange } from "@/lib/google-sheets";
import { descargarArchivo, listarArchivosPedido } from "@/lib/drive";

/** Descarga un adjunto del chat (solo si pertenece al hilo y el acceso lo permite). */
export async function GET(request: Request) {
  const acceso = accesoDe(await getSesion());
  if (!acceso) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const folio = (sp.get("folio") ?? "").trim();
  const id = (sp.get("id") ?? "").trim();
  if (!folio || !id) return NextResponse.json({ error: "Faltan parámetros." }, { status: 400 });

  try {
    let area = await areaDelHilo(folio);
    if (area === null) {
      // Sin chat aún: el área sale del pedido (archivos subidos directo a Drive).
      const pedidos = await readRange(articulosSheetId(), "Pedidos!A2:D");
      const fila = pedidos.find((r) => (r[0] ?? "").trim() === folio);
      area = fila ? normArea(fila[3] ?? "") : null;
    }
    if (area === null || !puedeVer(acceso, area)) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
    // Vale un adjunto del chat o cualquier archivo de la carpeta Drive del pedido.
    const adjunto =
      (await leerMensajes(folio)).flatMap((m) => m.adjuntos ?? []).find((a) => a.id === id) ??
      (await listarArchivosPedido(folio)).find((a) => a.id === id);
    if (!adjunto) return NextResponse.json({ error: "Archivo no encontrado." }, { status: 404 });

    const drive = await descargarArchivo(id);
    // Solo imágenes (no SVG) y PDF se muestran en el navegador; el resto se descarga.
    const inline = /^image\/(?!svg)/.test(adjunto.mime) || adjunto.mime === "application/pdf";
    return new Response(drive.body, {
      headers: {
        "Content-Type": adjunto.mime,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(adjunto.nombre)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
