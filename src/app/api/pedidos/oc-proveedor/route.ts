import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import { recepcionOC } from "@/lib/defontana";

// El proveedor de una OC no cambia, pero su estado sí (se aprueba, se recibe):
// se recuerda mientras viva la instancia, y el estado solo unos minutos.
const cache = new Map<string, { proveedor: string; estado: string; ts: number }>();
const VIGENCIA_MS = 5 * 60_000;

/**
 * Proveedor de cada OC de Defontana. Alimenta los filtros «Proveedor» y «N° de
 * OC» de Gestión de Pedidos: la planilla guarda solo el N° de OC.
 *
 * GET ?ocs=4800,4805  →  { proveedores: { "4800": "NOMBRE", ... },
 *                          estados: { "4800": "Aprobado", ... } }
 * (las OC que Defontana no encuentra se omiten)
 */
export async function GET(request: Request) {
  if (!(await haySesion())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const numeros = Array.from(
    new Set(
      (new URL(request.url).searchParams.get("ocs") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^\d{1,8}$/.test(s))
    )
  ).slice(0, 60);

  const proveedores: Record<string, string> = {};
  const estados: Record<string, string> = {};
  const pendientes = numeros.filter((n) => {
    const hit = cache.get(n);
    if (hit && Date.now() - hit.ts < VIGENCIA_MS) {
      proveedores[n] = hit.proveedor;
      estados[n] = hit.estado;
      return false;
    }
    return true;
  });

  // De 5 en 5 para no saturar a Defontana.
  for (let i = 0; i < pendientes.length; i += 5) {
    await Promise.all(
      pendientes.slice(i, i + 5).map(async (n) => {
        try {
          const oc = await recepcionOC(Number(n));
          if (oc?.proveedorNombre) {
            cache.set(n, { proveedor: oc.proveedorNombre, estado: oc.estadoTexto, ts: Date.now() });
            proveedores[n] = oc.proveedorNombre;
            estados[n] = oc.estadoTexto;
          }
        } catch {
          // error transitorio: se reintenta en la próxima consulta
        }
      })
    );
  }
  return NextResponse.json({ proveedores, estados });
}
