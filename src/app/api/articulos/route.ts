import { NextResponse } from "next/server";
import { getCategoriasConArticulos } from "@/lib/articulos";

// Cachea la respuesta 5 minutos para no golpear la API de Sheets en cada carga.
export const revalidate = 300;

export async function GET() {
  try {
    const categorias = await getCategoriasConArticulos();
    return NextResponse.json(
      { categorias },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
