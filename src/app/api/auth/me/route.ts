import { NextResponse } from "next/server";
import { getSesion } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const sesion = await getSesion();
  return NextResponse.json({
    perfil: sesion?.perfil ?? null,
    area: sesion?.area ?? null,
  });
}
