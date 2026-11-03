import { NextResponse } from "next/server";
import { getSesion } from "@/lib/auth";
import { accesoDe, areaDelHilo, leerMensajes, puedeVer } from "@/lib/chat";
import { descargarArchivo } from "@/lib/drive";

/** Descarga un adjunto del chat (solo si pertenece al hilo y el acceso lo permite). */
export async function GET(request: Request) {
  const acceso = accesoDe(await getSesion());
  if (!acceso) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const folio = (sp.get("folio") ?? "").trim();
  const id = (sp.get("id") ?? "").trim();
  if (!folio || !id) return NextResponse.json({ error: "Faltan parámetros." }, { status: 400 });

  try {
    const area = await areaDelHilo(folio);
    if (area === null || !puedeVer(acceso, area)) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
    const adjunto = (await leerMensajes(folio))
      .flatMap((m) => m.adjuntos ?? [])
      .find((a) => a.id === id);
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
