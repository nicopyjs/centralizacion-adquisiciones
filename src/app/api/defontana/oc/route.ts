import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import { recepcionOC } from "@/lib/defontana";

/**
 * Estado de recepción de una OC en Defontana.
 * GET ?numero=4481 -> { existe, estado, lineas: [{ codigo, pedida, recibida }] }
 */
export async function GET(request: Request) {
  if (!(await haySesion())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const numero = Number(new URL(request.url).searchParams.get("numero"));
  if (!Number.isInteger(numero) || numero <= 0 || numero > 99_999_999) {
    return NextResponse.json({ error: "N° de OC inválido." }, { status: 400 });
  }
  try {
    const oc = await recepcionOC(numero);
    if (!oc) return NextResponse.json({ existe: false });
    return NextResponse.json({ existe: true, estado: oc.estado, lineas: oc.lineas });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
