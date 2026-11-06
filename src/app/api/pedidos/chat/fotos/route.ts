import { NextResponse } from "next/server";
import { getSesion } from "@/lib/auth";
import { accesoDe, normArea, puedeVer } from "@/lib/chat";
import { listarArchivosPedido } from "@/lib/drive";
import { articulosSheetId, readRange } from "@/lib/google-sheets";

/** Archivos de la carpeta de Drive del pedido (chat y subidos directo a Drive). */
export async function GET(request: Request) {
  const acceso = accesoDe(await getSesion());
  if (!acceso) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const folio = (new URL(request.url).searchParams.get("folio") ?? "").trim();
  if (!folio) return NextResponse.json({ error: "Falta el folio." }, { status: 400 });

  try {
    const pedidos = await readRange(articulosSheetId(), "Pedidos!A2:D");
    const fila = pedidos.find((r) => (r[0] ?? "").trim() === folio);
    if (!fila || !puedeVer(acceso, normArea(fila[3] ?? ""))) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
    return NextResponse.json({ archivos: await listarArchivosPedido(folio) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
