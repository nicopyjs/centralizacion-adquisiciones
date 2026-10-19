import { NextResponse } from "next/server";
import { getPerfil } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ perfil: await getPerfil() });
}
