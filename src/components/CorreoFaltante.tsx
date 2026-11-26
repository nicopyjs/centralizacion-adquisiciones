"use client";

import { useEffect, useState } from "react";

/**
 * Aviso de un pedido reciente cuyo correo de solicitud no salió, con un botón
 * para enviarlo desde la cuenta Google de quien lo abre.
 */
export default function CorreoFaltante({
  folio,
  onEnviado,
}: {
  folio: string;
  onEnviado?: () => void;
}) {
  const [googleEmail, setGoogleEmail] = useState<string | null | undefined>(undefined);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<
    { ok: true; desde: string } | { ok: false; error: string } | null
  >(null);

  useEffect(() => {
    let cancelado = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelado) setGoogleEmail(d?.googleEmail ?? null);
      })
      .catch(() => {
        if (!cancelado) setGoogleEmail(null);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  async function enviar() {
    if (enviando) return;
    setEnviando(true);
    setResultado(null);
    try {
      const res = await fetch("/api/pedidos/correo/faltante", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folio }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.reconectar) setGoogleEmail(null);
        // 409: otro usuario ya lo envió; se refresca como enviado.
        if (res.status === 409) onEnviado?.();
        throw new Error(data.error || "No se pudo enviar el correo.");
      }
      setResultado({ ok: true, desde: data.desde as string });
      onEnviado?.();
    } catch (err) {
      setResultado({
        ok: false,
        error: err instanceof Error ? err.message : "Error desconocido",
      });
    } finally {
      setEnviando(false);
    }
  }

  const volver = typeof window === "undefined" ? "/" : window.location.pathname;

  if (resultado?.ok) {
    return (
      <p className="mt-2 rounded-lg bg-success-surface px-3 py-2 text-sm text-success">
        Correo enviado a Adquisiciones desde {resultado.desde}.
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-warning/40 bg-warning-surface px-3 py-2 text-sm text-warning">
      <p className="font-semibold">Este pedido no tiene correo enviado.</p>
      <p className="mt-0.5 text-xs">
        Se registró en la planilla pero el correo de solicitud a Adquisiciones no salió.
        Se envía con el formato de siempre (sin archivos adjuntos).
      </p>
      {googleEmail === null ? (
        <p className="mt-2 text-xs">
          Conecta tu cuenta de Google para enviarlo.{" "}
          <a
            href={`/api/auth/google/login?volver=${encodeURIComponent(volver)}`}
            className="font-bold underline"
          >
            Conectar con Google
          </a>
        </p>
      ) : (
        <button
          type="button"
          onClick={enviar}
          disabled={enviando || googleEmail === undefined}
          className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
        >
          {enviando ? "Enviando…" : `Enviar correo desde ${googleEmail ?? "…"}`}
        </button>
      )}
      {resultado && !resultado.ok && (
        <p className="mt-2 text-xs font-semibold text-destructive">{resultado.error}</p>
      )}
    </div>
  );
}
