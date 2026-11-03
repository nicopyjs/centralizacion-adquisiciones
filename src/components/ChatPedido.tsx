"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Adjunto = { id: string; nombre: string; mime: string; size: number };
type Mensaje = {
  id: string;
  rol: "adquisiciones" | "solicitante";
  autor: string;
  texto: string;
  ts: number;
  adjuntos: Adjunto[];
};

const MAX_ARCHIVOS = 3;
const MAX_BYTES = 4 * 1024 * 1024;
const REFRESCO_MS = 20_000;
const NO_LEIDOS_MS = 60_000;

/** folio → mensajes sin leer para la sesión actual; se refresca solo. */
export function useChatNoLeidos(): [Record<string, number>, () => void] {
  const [noLeidos, setNoLeidos] = useState<Record<string, number>>({});

  const refrescar = useCallback(() => {
    fetch("/api/pedidos/chat/no-leidos", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.noLeidos) setNoLeidos(d.noLeidos as Record<string, number>);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refrescar();
    const t = setInterval(() => {
      if (!document.hidden) refrescar();
    }, NO_LEIDOS_MS);
    return () => clearInterval(t);
  }, [refrescar]);

  return [noLeidos, refrescar];
}

/** Insignia "N nuevos" para la lista de pedidos. */
export function InsigniaChat({ cantidad }: { cantidad: number }) {
  if (cantidad <= 0) return null;
  return (
    <span
      title={`${cantidad} mensaje${cantidad === 1 ? "" : "s"} sin leer`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-foreground"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      </svg>
      {cantidad}
    </span>
  );
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTam(b: number): string {
  return b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

export default function ChatPedido({
  folio,
  rol,
  sinLeer = 0,
  onActividad,
}: {
  folio: string;
  /** Rol de quien mira: define qué mensajes son "míos". */
  rol: "adquisiciones" | "solicitante";
  /** Mensajes sin leer al montar: si hay, el hilo parte abierto. */
  sinLeer?: number;
  /** Se llama tras leer o enviar, para refrescar las insignias. */
  onActividad?: () => void;
}) {
  const [abierto, setAbierto] = useState(sinLeer > 0);
  const [mensajes, setMensajes] = useState<Mensaje[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);
  const actividadRef = useRef(onActividad);
  useEffect(() => {
    actividadRef.current = onActividad;
  });

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/pedidos/chat?folio=${encodeURIComponent(folio)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo cargar el chat.");
      setMensajes(data.mensajes ?? []);
      setError(null);
      actividadRef.current?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
  }, [folio]);

  // Mientras el hilo está abierto se refresca solo (pausado con la pestaña oculta).
  useEffect(() => {
    if (!abierto) return;
    const inicial = setTimeout(() => void cargar(), 0);
    const t = setInterval(() => {
      if (!document.hidden) void cargar();
    }, REFRESCO_MS);
    return () => {
      clearTimeout(inicial);
      clearInterval(t);
    };
  }, [abierto, cargar]);

  const cantidad = mensajes?.length ?? 0;
  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "nearest" });
  }, [cantidad, abierto]);

  function elegirArchivos(lista: FileList | null) {
    if (!lista) return;
    const sig = [...archivos, ...Array.from(lista)];
    if (sig.length > MAX_ARCHIVOS) {
      setError(`Máximo ${MAX_ARCHIVOS} archivos por mensaje.`);
    } else if (sig.reduce((s, f) => s + f.size, 0) > MAX_BYTES) {
      setError("Los archivos superan el máximo de 4 MB por mensaje.");
    } else {
      setError(null);
      setArchivos(sig);
    }
    if (inputArchivo.current) inputArchivo.current.value = "";
  }

  async function enviar() {
    if (enviando || (!texto.trim() && archivos.length === 0)) return;
    setEnviando(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("folio", folio);
      form.set("texto", texto.trim());
      for (const f of archivos) form.append("archivo", f);
      const res = await fetch("/api/pedidos/chat", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo enviar el mensaje.");
      setMensajes((prev) => [...(prev ?? []), data.mensaje as Mensaje]);
      setTexto("");
      setArchivos([]);
      actividadRef.current?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-card">
      <button
        type="button"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold text-primary"
      >
        <span className="flex items-center gap-2">
          {rol === "adquisiciones" ? "Chat con el solicitante" : "Consultas a Adquisiciones"}
          {!abierto && <InsigniaChat cantidad={sinLeer} />}
        </span>
        <span className="text-xs font-normal text-muted-foreground">
          {abierto ? "Ocultar" : "Abrir"}
        </span>
      </button>

      {abierto && (
        <div className="border-t border-border px-3 py-3">
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {mensajes === null && !error && (
              <p className="text-xs text-muted-foreground">Cargando…</p>
            )}
            {mensajes?.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Aún no hay mensajes. Escribe tu consulta sobre este pedido.
              </p>
            )}
            {mensajes?.map((m) => {
              const mio = m.rol === rol;
              return (
                <div key={m.id} className={`flex ${mio ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      mio ? "bg-accent/10 text-card-foreground" : "bg-muted text-card-foreground"
                    }`}
                  >
                    <p className="text-[11px] font-semibold text-muted-foreground">
                      {m.autor} · {formatTs(m.ts)}
                    </p>
                    {m.texto && <p className="mt-0.5 whitespace-pre-wrap break-words">{m.texto}</p>}
                    {m.adjuntos?.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {m.adjuntos.map((a) => (
                          <li key={a.id}>
                            <a
                              href={`/api/pedidos/chat/archivo?folio=${encodeURIComponent(folio)}&id=${encodeURIComponent(a.id)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="break-all text-xs font-semibold text-accent hover:underline"
                            >
                              📎 {a.nombre}
                            </a>{" "}
                            <span className="text-[11px] text-muted-foreground">
                              ({formatTam(a.size)})
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={finRef} />
          </div>

          {error && (
            <p role="alert" className="mt-2 text-xs font-semibold text-destructive">
              {error}
            </p>
          )}

          {archivos.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {archivos.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                >
                  📎 {f.name} ({formatTam(f.size)})
                  <button
                    type="button"
                    aria-label={`Quitar ${f.name}`}
                    onClick={() => setArchivos((prev) => prev.filter((_, j) => j !== i))}
                    className="font-bold text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 flex items-end gap-2">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              rows={2}
              maxLength={2000}
              placeholder="Escribe un mensaje… (Enter envía, Shift+Enter salto de línea)"
              className="min-h-[2.5rem] flex-1 resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm"
            />
            <input
              ref={inputArchivo}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => elegirArchivos(e.target.files)}
            />
            <button
              type="button"
              onClick={() => inputArchivo.current?.click()}
              disabled={enviando || archivos.length >= MAX_ARCHIVOS}
              title="Adjuntar archivo (máx. 3, 4 MB en total)"
              className="inline-flex h-10 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm hover:bg-muted disabled:opacity-40"
            >
              Adjuntar
            </button>
            <button
              type="button"
              onClick={() => void enviar()}
              disabled={enviando || (!texto.trim() && archivos.length === 0)}
              className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {enviando ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
