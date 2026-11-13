import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { GOOGLE_COOKIE, emailDeToken } from "@/lib/google-cookie";

/**
 * Toda la app exige haber iniciado sesión con Google con una cuenta
 * @nebchile.cl. Sin sesión: las páginas redirigen a /acceso y la API responde
 * 401. Solo quedan públicas la pantalla de acceso y el flujo de login.
 * (Los perfiles de Gestión de Pedidos / Pedidos del Área / KPIs siguen
 * validándose en cada página y ruta, encima de esto.)
 */

const PUBLICAS = [
  "/acceso",
  "/api/auth/google/login",
  "/api/auth/google/callback",
  "/api/auth/logout",
];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLICAS.some((p) => pathname === p)) return NextResponse.next();

  if (emailDeToken(request.cookies.get(GOOGLE_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const destino = new URL("/acceso", request.url);
  destino.searchParams.set("volver", pathname + search);
  return NextResponse.redirect(destino);
}

export const config = {
  // Todo menos los archivos internos de Next y las imágenes de /public.
  matcher: ["/((?!_next/static|_next/image|favicon\.ico|.*\.(?:jpg|png|svg)$).*)"],
};
