import { NextResponse } from "next/server";
import { getCentrosNegocio } from "@/lib/centros";

// Los centros cambian poco: cache de 30 min.
export const revalidate = 1800;

export async function GET() {
  try {
    const centros = await getCentrosNegocio();
    return NextResponse.json(
      { centros },
      {
        headers: {
          "Cache-Control": "s-maxage=1800, stale-while-revalidate=3600",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
