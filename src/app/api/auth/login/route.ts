import { NextResponse } from "next/server";
import {
  type Area,
  SESSION_COOKIE,
  SESSION_SECONDS,
  crearToken,
  esArea,
  esPerfil,
  passwordCorrecta,
} from "@/lib/auth";

export async function POST(request: Request) {
  let body: { usuario?: unknown; area?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { usuario?: unknown; area?: unknown; password?: unknown };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const perfil = body.usuario ?? "adquisiciones";
  if (!esPerfil(perfil) || !passwordCorrecta(perfil, body.password)) {
    // Pequeña espera para frenar intentos por fuerza bruta.
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json(
      { error: "Usuario o contraseña incorrectos." },
      { status: 401 }
    );
  }

  // Supervisor y maestro entran a un área concreta; Adquisiciones ve todas.
  let area: Area | null = null;
  if (perfil !== "adquisiciones") {
    if (!esArea(body.area)) {
      return NextResponse.json({ error: "Elige un área." }, { status: 400 });
    }
    area = body.area;
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, crearToken(perfil, area), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return res;
}
