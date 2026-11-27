import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import { buscarOCsDeProveedor } from "@/lib/defontana";

/**
 * N° de las OC de Defontana (últimos 12 meses, cualquier estado) de un
 * proveedor por nombre o RUT. Alimenta el buscador de Gestión de Pedidos:
 * el proveedor no está en la planilla, solo la OC asociada a cada artículo.
 *
 * GET ?q=texto  →  { ocs: number[] }
 */
export async function GET(request: Request) {
  if (!(await haySesion())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 3) return NextResponse.json({ ocs: [] });
  try {
    const ocs = (await buscarOCsDeProveedor(q)).map((o) => o.numero);
    return NextResponse.json({ ocs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
