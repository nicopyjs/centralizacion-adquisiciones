"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const fieldClass =
  "h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-card-foreground shadow-sm outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const labelClass =
  "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

export default function LoginGestion({ usuario }: { usuario: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (!password || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo iniciar sesión.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setEnviando(false);
    }
  }

  return (
    <form
      onSubmit={entrar}
      className="mx-auto w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm"
    >
      <h2 className="text-lg font-extrabold tracking-tight text-primary">
        Acceso restringido
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Esta sección es solo para el equipo de Adquisiciones.
      </p>

      <div className="mt-5">
        <label htmlFor="usuario" className={labelClass}>
          Usuario
        </label>
        {/* Fijo; se deja como campo para los gestores de contraseñas. */}
        <input
          id="usuario"
          name="username"
          autoComplete="username"
          className={fieldClass}
          value={usuario}
          readOnly
          tabIndex={-1}
        />
      </div>

      <div className="mt-4">
        <label htmlFor="password" className={labelClass}>
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          className={fieldClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!password || enviando}
        className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand px-4 text-sm font-bold text-brand-foreground shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {enviando ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
