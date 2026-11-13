"use client";

import { usePathname, useSearchParams } from "next/navigation";

const MOTIVOS: Record<string, string> = {
  dominio: "Usa tu cuenta @nebchile.cl.",
  "sin-acceso":
    "Tu cuenta @nebchile.cl no tiene acceso asignado. Pide a Adquisiciones que la agregue.",
  permisos: "Debes aceptar el permiso para enviar correos.",
  cancelado: "Cancelaste el inicio de sesión con Google.",
  config: "El inicio de sesión con Google no está configurado.",
};

export default function LoginGestion() {
  const pathname = usePathname();
  const q = useSearchParams();
  // En /acceso la página a la que volver viene en la URL.
  const volver = pathname === "/acceso" ? (q.get("volver") ?? "/") : pathname;
  const error =
    q.get("google") === "error"
      ? (MOTIVOS[q.get("motivo") ?? ""] ??
        "No se pudo iniciar sesión con Google. Inténtalo de nuevo.")
      : null;

  return (
    <div className="mx-auto w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-extrabold tracking-tight text-primary">
        Acceso restringido
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Inicia sesión con tu cuenta de Google @nebchile.cl para continuar.
      </p>

      {error && (
        <p role="alert" className="mt-4 text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <a
        href={`/api/auth/google/login?volver=${encodeURIComponent(volver)}`}
        className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover"
      >
        Entrar con Google (cuenta @nebchile.cl)
      </a>
    </div>
  );
}
