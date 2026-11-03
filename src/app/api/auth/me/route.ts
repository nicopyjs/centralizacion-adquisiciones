import { NextResponse } from "next/server";
import { getSesion } from "@/lib/auth";
import { getGoogleEmail } from "@/lib/google-oauth";
import { perfilDeEmail } from "@/lib/usuarios";

export const dynamic = "force-dynamic";

export async function GET() {
  const sesion = await getSesion();
  const googleEmail = await getGoogleEmail();
  const usuario = perfilDeEmail(googleEmail);
  return NextResponse.json({
    perfil: sesion?.perfil ?? null,
    area: sesion?.area ?? null,
    googleEmail,
    // Áreas entre las que puede cambiar (solo si entró con Google).
    areasPermitidas: sesion ? (usuario?.areas ?? []) : [],
    admin: Boolean(sesion && usuario?.admin),
  });
}
