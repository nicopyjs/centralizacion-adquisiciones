import { NextResponse } from "next/server";
import { haySesion } from "@/lib/auth";
import { ambienteDefontana, listarBodegas } from "@/lib/defontana";

/** Bodegas activas de Defontana + ambiente en uso (para el diálogo de consumo interno). */
export async function GET() {
  if (!(await haySesion())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  try {
    return NextResponse.json({
      ambiente: ambienteDefontana(),
      bodegas: await listarBodegas(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
