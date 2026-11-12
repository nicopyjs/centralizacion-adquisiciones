import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { GOOGLE_COOKIE } from "@/lib/google-oauth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // También se suelta la cuenta Google conectada: si no, el siguiente que use
  // este navegador enviaría sus correos desde la cuenta de quien salió.
  res.cookies.set(GOOGLE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
