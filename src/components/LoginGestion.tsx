"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const fieldClass =
  "h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-card-foreground shadow-sm outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const labelClass =
  "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

// Adquisiciones ve todas las áreas; supervisor y maestro entran a una sola.
const AREAS = [
  { id: "refacciones", label: "Refacciones" },
  { id: "servicio-tecnico", label: "Servicio Técnico" },
  { id: "instalaciones", label: "Instalaciones" },
  { id: "transicion-postventa", label: "Transición y Postventa" },
];
const TODAS = "adquisiciones";
const ROLES = [
  { id: "supervisor", label: "Supervisor" },
  { id: "maestro", label: "Maestro" },
];

export default function LoginGestion({
  areaInicial = TODAS,
}: {
  areaInicial?: string;
}) {
  const [area, setArea] = useState(areaInicial);
  const [rol, setRol] = useState("supervisor");
  const esAdq = area === TODAS;
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
        body: JSON.stringify(
          esAdq ? { usuario: TODAS, password } : { usuario: rol, area, password }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo iniciar sesión.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setEnviando(false);
    }
  }

  const volver =
    typeof window === "undefined" ? "/" : window.location.pathname;

  return (
    <form
      onSubmit={entrar}
      className="mx-auto w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm"
    >
      <h2 className="text-lg font-extrabold tracking-tight text-primary">
        Acceso restringido
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Elige tu área y usuario e ingresa la contraseña para continuar.
      </p>

      <a
        href={`/api/auth/google/login?volver=${encodeURIComponent(volver)}`}
        className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover"
      >
        Entrar con Google (cuenta @nebchile.cl)
      </a>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        o con contraseña
      </p>

      <div className="mt-3">
        <label htmlFor="area" className={labelClass}>
          Área
        </label>
        <select
          id="area"
          className={fieldClass}
          value={area}
          onChange={(e) => setArea(e.target.value)}
        >
          {AREAS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
          <option value={TODAS}>Adquisiciones (todas las áreas)</option>
        </select>
      </div>

      {!esAdq && (
        <div className="mt-4">
          <label htmlFor="usuario" className={labelClass}>
            Usuario
          </label>
          <select
            id="usuario"
            name="username"
            autoComplete="username"
            className={fieldClass}
            value={rol}
            onChange={(e) => setRol(e.target.value)}
          >
            {ROLES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      )}

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
