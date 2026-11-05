import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import { stockPorBodega } from "@/lib/defontana";

/**
 * Stock de unos artículos en cada bodega activa de Defontana.
 * GET ?codigos=AICA0081,AICA0083 -> { stock: { BC14: { AICA0081: 10, ... } } }
 */
export async function GET(request: Request) {
  if (!(await haySesion())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const codigos = Array.from(
    new Set(
      (new URL(request.url).searchParams.get("codigos") ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    )
  );
  if (codigos.length === 0 || codigos.length > 100) {
    return NextResponse.json({ error: "Códigos inválidos." }, { status: 400 });
  }
  try {
    return NextResponse.json({ stock: await stockPorBodega(codigos) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
