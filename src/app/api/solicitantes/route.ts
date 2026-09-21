import { NextResponse } from "next/server";
import { getSolicitantes } from "@/lib/solicitantes";

// La nómina cambia poco: cache de 30 min.
export const revalidate = 1800;

export async function GET() {
  try {
    const solicitantes = await getSolicitantes();
    return NextResponse.json(
      { solicitantes },
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
