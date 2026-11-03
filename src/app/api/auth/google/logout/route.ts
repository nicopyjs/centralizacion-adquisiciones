import { NextResponse } from "next/server";
import {
  GOOGLE_COOKIE,
  borrarRefreshToken,
  getGoogleEmail,
} from "@/lib/google-oauth";

/** Desconecta la cuenta: borra el refresh token guardado y la cookie. */
export async function POST() {
  const email = await getGoogleEmail();
  if (email) await borrarRefreshToken(email);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GOOGLE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
