import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_SECONDS, crearToken, esArea } from "@/lib/auth";
import { getGoogleEmail } from "@/lib/google-oauth";
import { perfilDeEmail } from "@/lib/usuarios";

/**
 * Cambia la vista de la sesión según los permisos de la cuenta Google:
 *  - supervisor con varias áreas: elige entre las suyas.
 *  - admin: elige cualquier área o "adquisiciones" (vista de Gestión).
 */
export async function POST(request: Request) {
  const usuario = perfilDeEmail(await getGoogleEmail());
  if (!usuario) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { area?: unknown };

  let token: string;
  if (body.area === "adquisiciones" && usuario.admin) {
    token = crearToken("adquisiciones", null);
  } else if (esArea(body.area) && usuario.areas.includes(body.area)) {
    token = crearToken("supervisor", body.area);
  } else {
    return NextResponse.json({ error: "Área no permitida." }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return res;
}
