import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_SECONDS, crearToken } from "@/lib/auth";
import { perfilDeEmail } from "@/lib/usuarios";
import {
  DOMINIO,
  GOOGLE_COOKIE,
  GOOGLE_SESSION_SECONDS,
  GOOGLE_STATE_COOKIE,
  concedioEnvio,
  crearCliente,
  crearTokenSesion,
  guardarRefreshToken,
  rutaSegura,
} from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const cookie = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${GOOGLE_STATE_COOKIE}=`))
    ?.slice(GOOGLE_STATE_COOKIE.length + 1);
  const [state, volverRaw] = decodeURIComponent(cookie ?? "").split("|");
  const volver = rutaSegura(volverRaw);

  function terminar(motivo?: string) {
    const destino = new URL(volver, request.url);
    destino.searchParams.set("google", motivo ? "error" : "ok");
    if (motivo) destino.searchParams.set("motivo", motivo);
    const res = NextResponse.redirect(destino);
    res.cookies.set(GOOGLE_STATE_COOKIE, "", {
      path: "/api/auth/google",
      maxAge: 0,
    });
    return res;
  }

  const code = params.get("code");
  if (params.get("error") || !code) return terminar("cancelado");
  if (!state || params.get("state") !== state) return terminar("estado");

  try {
    const cliente = crearCliente(request);
    const { tokens } = await cliente.getToken(code);
    if (!tokens.id_token) return terminar("sin-identidad");

    const ticket = await cliente.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_OAUTH_CLIENT_ID,
    });
    const p = ticket.getPayload();
    const email = p?.email?.toLowerCase();
    if (!email || !p?.email_verified || p.hd !== DOMINIO) {
      return terminar("dominio");
    }
    if (!concedioEnvio(tokens.scope)) return terminar("permisos");
    if (!tokens.refresh_token) return terminar("sin-refresh");

    await guardarRefreshToken(email, tokens.refresh_token);

    const res = terminar();
    res.cookies.set(GOOGLE_COOKIE, crearTokenSesion(email), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: GOOGLE_SESSION_SECONDS,
    });

    // El perfil sale del correo: es la única forma de entrar a las vistas
    // restringidas. Sin perfil, Google queda conectado (sirve para enviar
    // correos desde Enviar Pedido) pero no se abre ninguna sesión.
    const usuario = perfilDeEmail(email);
    if (!usuario && /^\/(gestion-pedidos|mis-pedidos|kpis)(\/|$)/.test(volver)) {
      const sinAcceso = terminar("sin-acceso");
      sinAcceso.cookies.set(GOOGLE_COOKIE, crearTokenSesion(email), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: GOOGLE_SESSION_SECONDS,
      });
      return sinAcceso;
    }
    if (usuario) {
      res.cookies.set(
        SESSION_COOKIE,
        crearToken(
          usuario.perfil,
          usuario.perfil === "adquisiciones" ? null : (usuario.areas[0] ?? null)
        ),
        {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: SESSION_SECONDS,
        }
      );
    }
    return res;
  } catch (err) {
    console.error("Callback de Google falló:", err);
    return terminar("fallo");
  }
}
