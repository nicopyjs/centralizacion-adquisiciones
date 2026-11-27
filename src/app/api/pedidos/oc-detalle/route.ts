import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import { detalleOC } from "@/lib/defontana";

/**
 * Datos completos de una OC de Defontana (cabecera, líneas y documentos de
 * compra relacionados) para el detalle de Gestión de Pedidos.
 *
 * GET ?numero=4756
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
    const oc = await detalleOC(numero);
    if (!oc) return NextResponse.json({ error: "Defontana no encontró esa OC." }, { status: 404 });
    return NextResponse.json({ oc });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
