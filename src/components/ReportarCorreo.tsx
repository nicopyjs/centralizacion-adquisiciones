"use client";

import { useEffect, useRef, useState } from "react";

const MAX_ADJUNTOS = 3;
const MAX_BYTES = 4 * 1024 * 1024;
const EXT = /\.(pdf|xlsx|xls|csv|docx|doc|png|jpe?g)$/i;

type Linea = {
  nombre: string;
  unidad: string;
  cantidad: number;
  cantidadRecibida: number | null;
};

type Previa =
  | { tieneCadena: false; reportes: Reporte[] }
  | {
      tieneCadena: true;
      asunto: string;
      para: string[];
      cc: string[];
      reportes: Reporte[];
    };

type Reporte = { ts: number; por: string; oc: string; nota: string };

const campo =
  "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-card-foreground shadow-sm outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40";
const etiqueta =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

function textoLinea(l: Linea): string {
  const cant = l.cantidadRecibida ?? l.cantidad;
  return `- ${cant} ${l.unidad} ${l.nombre}`.replace(/\s+/g, " ").trim();
}

function fechaCorta(ts: number): string {
  return new Date(ts).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" });
}

/**
 * Reporte por correo de un pedido (consumo interno, etc.): sale como respuesta
 * en la cadena del correo original, con copia al área y a gerencia.
 */
export default function ReportarCorreo({
  folio,
  items,
}: {
  folio: string;
  items: Linea[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [errorPrevia, setErrorPrevia] = useState<string | null>(null);
  const [googleEmail, setGoogleEmail] = useState<string | null | undefined>(undefined);

  const [oc, setOc] = useState("");
  const [nota, setNota] = useState("");
  const [comentario, setComentario] = useState("");
  const [marcados, setMarcados] = useState<boolean[]>(() => items.map(() => true));
  const [adjuntos, setAdjuntos] = useState<File[]>([]);
  const [errorAdjuntos, setErrorAdjuntos] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<
    { ok: true; enCadena: boolean } | { ok: false; error: string } | null
  >(null);
  const inputArchivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!abierto) return;
    let cancelado = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelado) setGoogleEmail(d?.googleEmail ?? null);
      })
      .catch(() => {});
    fetch(`/api/pedidos/reporte?folio=${encodeURIComponent(folio)}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "No se pudo cargar.");
        if (!cancelado) {
          setPrevia(d as Previa);
          setErrorPrevia(null);
        }
      })
      .catch((e) => {
        if (!cancelado) setErrorPrevia(e instanceof Error ? e.message : "Error");
      });
    return () => {
      cancelado = true;
    };
  }, [abierto, folio, resultado]);

  function elegirArchivos(lista: FileList | null) {
    if (!lista) return;
    const sig = [...adjuntos, ...Array.from(lista)];
    if (sig.length > MAX_ADJUNTOS) setErrorAdjuntos(`Máximo ${MAX_ADJUNTOS} archivos.`);
    else if (sig.reduce((s, f) => s + f.size, 0) > MAX_BYTES)
      setErrorAdjuntos("Los archivos superan el máximo de 4 MB en total.");
    else if (sig.some((f) => !EXT.test(f.name)))
      setErrorAdjuntos("Solo PDF, Excel, Word, CSV o imágenes (PNG/JPG).");
    else {
      setErrorAdjuntos(null);
      setAdjuntos(sig);
    }
    if (inputArchivo.current) inputArchivo.current.value = "";
  }

  async function enviar() {
    if (enviando || !oc.trim()) return;
    setEnviando(true);
    setResultado(null);
    try {
      const form = new FormData();
      form.set("folio", folio);
      form.set("oc", oc.trim());
      form.set("nota", nota.trim());
      form.set("comentario", comentario.trim());
      form.set(
        "items",
        items
          .filter((_, i) => marcados[i])
          .map(textoLinea)
          .join("\n")
      );
      for (const f of adjuntos) form.append("archivo", f);
      const res = await fetch("/api/pedidos/reporte", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        if (data.reconectar) setGoogleEmail(null);
        throw new Error(data.error || "No se pudo enviar el reporte.");
      }
      setResultado({ ok: true, enCadena: Boolean(data.enCadena) });
      setOc("");
      setNota("");
      setComentario("");
      setAdjuntos([]);
    } catch (err) {
      setResultado({
        ok: false,
        error: err instanceof Error ? err.message : "Error desconocido",
      });
    } finally {
      setEnviando(false);
    }
  }

  const reportes = previa?.reportes ?? [];
  const volver =
    typeof window === "undefined" ? "/" : window.location.pathname;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted"
      >
        Reportar por correo
        {reportes.length > 0 && (
          <span className="rounded-full bg-success-surface px-2 py-0.5 text-[11px] font-bold text-success">
            Reportado ✓
          </span>
        )}
      </button>

      {abierto && (
        <div className="mt-2 rounded-xl border border-border bg-card p-4 shadow-sm">
          {errorPrevia && (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {errorPrevia}
            </p>
          )}

          {previa && !previa.tieneCadena && (
            <p className="text-sm text-muted-foreground">
              Este pedido no tiene su cadena de correo registrada: solo se pueden
              reportar los pedidos enviados desde la app con la cuenta de Google
              conectada.
            </p>
          )}

          {previa?.tieneCadena && (
            <>
              <p className="text-xs text-muted-foreground">
                Se envía como respuesta en la cadena del pedido{" "}
                <strong className="text-primary">{folio}</strong>.
              </p>
              <dl className="mt-2 grid gap-x-3 gap-y-1 rounded-lg bg-muted/50 p-3 text-xs sm:grid-cols-[auto_1fr]">
                <dt className="font-semibold text-muted-foreground">Para</dt>
                <dd className="break-words">{previa.para.join(", ")}</dd>
                <dt className="font-semibold text-muted-foreground">CC</dt>
                <dd className="break-words">{previa.cc.join(", ")}</dd>
                <dt className="font-semibold text-muted-foreground">Asunto</dt>
                <dd className="break-words">{previa.asunto}</dd>
              </dl>

              {googleEmail === null ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Conecta tu cuenta de Google para enviar el reporte.{" "}
                  <a
                    href={`/api/auth/google/login?volver=${encodeURIComponent(volver)}`}
                    className="font-bold text-accent underline"
                  >
                    Conectar con Google
                  </a>
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor={`oc-${folio}`} className={etiqueta}>
                        N° de OC <span className="text-destructive">*</span>
                      </label>
                      <input
                        id={`oc-${folio}`}
                        className={campo}
                        value={oc}
                        onChange={(e) => setOc(e.target.value)}
                        placeholder="Ej. 4589"
                        inputMode="numeric"
                      />
                    </div>
                    <div>
                      <label htmlFor={`nota-${folio}`} className={etiqueta}>
                        Estado
                      </label>
                      <input
                        id={`nota-${folio}`}
                        className={campo}
                        list={`notas-${folio}`}
                        value={nota}
                        onChange={(e) => setNota(e.target.value)}
                        placeholder="Ej. Incompleto-Entregado"
                      />
                      <datalist id={`notas-${folio}`}>
                        <option value="Completo-Entregado" />
                        <option value="Incompleto-Entregado" />
                      </datalist>
                    </div>
                  </div>

                  <div>
                    <span className={etiqueta}>Artículos que se reportan</span>
                    <ul className="space-y-1">
                      {items.map((l, i) => (
                        <li key={`${l.nombre}-${i}`}>
                          <label className="flex cursor-pointer items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 accent-accent"
                              checked={marcados[i] ?? true}
                              onChange={(e) =>
                                setMarcados((prev) =>
                                  prev.map((v, j) => (j === i ? e.target.checked : v))
                                )
                              }
                            />
                            <span>{textoLinea(l).replace(/^- /, "")}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <label htmlFor={`com-${folio}`} className={etiqueta}>
                      Comentario
                    </label>
                    <textarea
                      id={`com-${folio}`}
                      className={`${campo} h-auto py-2`}
                      rows={2}
                      value={comentario}
                      onChange={(e) => setComentario(e.target.value)}
                      placeholder="Opcional"
                    />
                  </div>

                  <div>
                    <span className={etiqueta}>Consumo interno (adjunto)</span>
                    <input
                      ref={inputArchivo}
                      type="file"
                      multiple
                      accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.png,.jpg,.jpeg"
                      className="hidden"
                      onChange={(e) => elegirArchivos(e.target.files)}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => inputArchivo.current?.click()}
                        disabled={adjuntos.length >= MAX_ADJUNTOS}
                        className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm hover:bg-muted disabled:opacity-40"
                      >
                        Adjuntar archivo
                      </button>
                      <span className="text-xs text-muted-foreground">
                        Máx. {MAX_ADJUNTOS} archivos y 4 MB en total.
                      </span>
                    </div>
                    {adjuntos.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {adjuntos.map((f, i) => (
                          <li
                            key={`${f.name}-${i}`}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-1 text-sm"
                          >
                            <span className="min-w-0 truncate">{f.name}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setAdjuntos((prev) => prev.filter((_, j) => j !== i))
                              }
                              className="shrink-0 text-xs font-semibold text-destructive hover:underline"
                            >
                              Quitar
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {errorAdjuntos && (
                      <p role="alert" className="mt-1 text-xs font-semibold text-destructive">
                        {errorAdjuntos}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void enviar()}
                      disabled={enviando || !oc.trim()}
                      className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {enviando ? "Enviando…" : "Enviar reporte"}
                    </button>
                    {googleEmail && (
                      <span className="text-xs text-muted-foreground">
                        Se envía desde {googleEmail}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {resultado && (
                <p
                  role="status"
                  className={`mt-3 text-sm font-semibold ${
                    resultado.ok ? "text-success" : "text-destructive"
                  }`}
                >
                  {resultado.ok
                    ? resultado.enCadena
                      ? "Reporte enviado en la cadena del pedido."
                      : "Reporte enviado. No encontré el correo original en tu buzón, pero los demás lo verán dentro de la cadena."
                    : resultado.error}
                </p>
              )}
            </>
          )}

          {reportes.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className={etiqueta}>Reportes enviados</p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {reportes.map((r) => (
                  <li key={r.ts}>
                    {fechaCorta(r.ts)} · OC {r.oc}
                    {r.nota ? ` · ${r.nota}` : ""} · {r.por}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
