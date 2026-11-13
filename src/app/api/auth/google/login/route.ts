import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  DOMINIO,
  GOOGLE_STATE_COOKIE,
  SCOPES,
  crearCliente,
  oauthConfigurado,
  rutaSegura,
} from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

/** Inicia el login con Google. `?volver=/ruta` indica a dónde regresar. */
export async function GET(request: Request) {
  const volver = rutaSegura(new URL(request.url).searchParams.get("volver"));
  if (!oauthConfigurado()) {
    return NextResponse.redirect(
      new URL(
        `/acceso?volver=${encodeURIComponent(volver)}&google=error&motivo=config`,
        request.url
      )
    );
  }

  const state = randomBytes(16).toString("hex");
  const url = crearCliente(request).generateAuthUrl({
    access_type: "offline",
    // Fuerza entregar siempre un refresh token (necesario para enviar después).
    prompt: "consent",
    scope: SCOPES,
    state,
    hd: DOMINIO,
  });

  const res = NextResponse.redirect(url);
  res.cookies.set(GOOGLE_STATE_COOKIE, `${state}|${volver}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}
