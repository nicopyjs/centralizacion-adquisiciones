import { NextResponse } from "next/server";
import { getSesion } from "@/lib/auth";
import { accesoDe, noLeidos } from "@/lib/chat";

/** folio → mensajes sin leer para la sesión actual (insignias de la lista). */
export async function GET() {
  const acceso = accesoDe(await getSesion());
  if (!acceso) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  try {
    return NextResponse.json({ noLeidos: await noLeidos(acceso) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
