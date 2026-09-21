import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_SECONDS,
  crearToken,
  passwordCorrecta,
} from "@/lib/auth";

export async function POST(request: Request) {
  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!passwordCorrecta(body.password)) {
    // Pequeña espera para frenar intentos por fuerza bruta.
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json(
      { error: "Contraseña incorrecta." },
      { status: 401 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, crearToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return res;
}
