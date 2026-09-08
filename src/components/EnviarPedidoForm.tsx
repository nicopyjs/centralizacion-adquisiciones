"use client";

import { useEffect, useMemo, useState } from "react";

type Articulo = {
  codigo: string;
  nombre: string;
  categoriaId: string;
  categoria: string;
  unidad: string;
};

type CategoriaConArticulos = {
  categoriaId: string;
  categoria: string;
  articulos: Articulo[];
};

type LineaPedido = {
  codigo: string;
  nombre: string;
  categoria: string;
  unidad: string;
  cantidad: number;
};

const fieldClass =
  "h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-card-foreground shadow-sm outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const labelClass =
  "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

function SectionCard({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-brand-foreground"
        >
          {step}
        </span>
        <div>
          <h2 className="text-sm font-bold text-primary">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function IconPlus() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function EnviarPedidoForm() {
  const [categorias, setCategorias] = useState<CategoriaConArticulos[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [solicitante, setSolicitante] = useState("");
  const [area, setArea] = useState("");
  const [comentario, setComentario] = useState("");

  const [categoriaSel, setCategoriaSel] = useState("");
  const [articuloSel, setArticuloSel] = useState("");
  const [cantidad, setCantidad] = useState("1");

  const [lineas, setLineas] = useState<LineaPedido[]>([]);

  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<
    { ok: true; pedidoId: string } | { ok: false; error: string } | null
  >(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch("/api/articulos");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al cargar artículos");
        if (!cancelado) setCategorias(data.categorias ?? []);
      } catch (err) {
        if (!cancelado)
          setLoadError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const articulosDeCategoria = useMemo(() => {
    const cat = categorias.find((c) => c.categoria === categoriaSel);
    return cat ? cat.articulos : [];
  }, [categorias, categoriaSel]);

  const articuloActual = useMemo(
    () => articulosDeCategoria.find((a) => a.codigo === articuloSel) ?? null,
    [articulosDeCategoria, articuloSel]
  );

  const totalUnidades = useMemo(
    () => lineas.reduce((sum, l) => sum + l.cantidad, 0),
    [lineas]
  );

  function agregarLinea() {
    if (!articuloActual) return;
    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || cant <= 0) return;

    setLineas((prev) => {
      const existente = prev.find((l) => l.codigo === articuloActual.codigo);
      if (existente) {
        return prev.map((l) =>
          l.codigo === articuloActual.codigo
            ? { ...l, cantidad: l.cantidad + cant }
            : l
        );
      }
      return [
        ...prev,
        {
          codigo: articuloActual.codigo,
          nombre: articuloActual.nombre,
          categoria: articuloActual.categoria,
          unidad: articuloActual.unidad,
          cantidad: cant,
        },
      ];
    });
    setArticuloSel("");
    setCantidad("1");
    setResultado(null);
  }

  function quitarLinea(codigo: string) {
    setLineas((prev) => prev.filter((l) => l.codigo !== codigo));
  }

  async function enviarPedido() {
    setEnviando(true);
    setResultado(null);
    try {
      const res = await fetch("/api/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solicitante, area, comentario, items: lineas }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al enviar el pedido");
      setResultado({ ok: true, pedidoId: data.pedidoId });
      setLineas([]);
      setComentario("");
    } catch (err) {
      setResultado({
        ok: false,
        error: err instanceof Error ? err.message : "Error desconocido",
      });
    } finally {
      setEnviando(false);
    }
  }

  const puedeEnviar =
    solicitante.trim().length > 0 && lineas.length > 0 && !enviando;

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-live="polite">
        <span className="sr-only">Cargando artículos…</span>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-xl border border-border bg-muted/50"
          />
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-warning/40 bg-warning-surface p-5 text-sm text-warning"
      >
        <p className="font-semibold">No se pudieron cargar los artículos.</p>
        <p className="mt-1">{loadError}</p>
        <p className="mt-2 text-warning/90">
          Verifica que las variables de entorno de Google (cuenta de servicio y{" "}
          <code className="rounded bg-warning/10 px-1 py-0.5 font-mono text-xs">
            SHEET_ID
          </code>
          ) estén configuradas y que el spreadsheet esté compartido con la cuenta
          de servicio.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionCard
        step={1}
        title="Datos del pedido"
        description="Quién solicita y para qué."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="solicitante" className={labelClass}>
              Solicitante <span className="text-destructive">*</span>
            </label>
            <input
              id="solicitante"
              className={fieldClass}
              value={solicitante}
              onChange={(e) => setSolicitante(e.target.value)}
              placeholder="Nombre de quien solicita"
              autoComplete="name"
            />
          </div>
          <div>
            <label htmlFor="area" className={labelClass}>
              Área / Proyecto
            </label>
            <input
              id="area"
              className={fieldClass}
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Opcional"
            />
          </div>
        </div>
        <div className="mt-4">
          <label htmlFor="comentario" className={labelClass}>
            Comentario
          </label>
          <textarea
            id="comentario"
            className={`${fieldClass} h-auto py-2.5`}
            rows={2}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            placeholder="Opcional"
          />
        </div>
      </SectionCard>

      <SectionCard
        step={2}
        title="Agregar artículo"
        description="Elige categoría, luego el artículo y la cantidad."
      >
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_130px_auto] sm:items-end">
          <div>
            <label htmlFor="categoria" className={labelClass}>
              Categoría
            </label>
            <select
              id="categoria"
              className={fieldClass}
              value={categoriaSel}
              onChange={(e) => {
                setCategoriaSel(e.target.value);
                setArticuloSel("");
              }}
            >
              <option value="">Selecciona…</option>
              {categorias.map((c) => (
                <option key={c.categoria} value={c.categoria}>
                  {c.categoria} ({c.articulos.length})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="articulo" className={labelClass}>
              Artículo
            </label>
            <select
              id="articulo"
              className={fieldClass}
              value={articuloSel}
              onChange={(e) => setArticuloSel(e.target.value)}
              disabled={!categoriaSel}
            >
              <option value="">
                {categoriaSel ? "Selecciona…" : "Elige categoría primero"}
              </option>
              {articulosDeCategoria.map((a) => (
                <option key={a.codigo} value={a.codigo}>
                  {a.nombre} — {a.codigo}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="cantidad" className={labelClass}>
              Cantidad{articuloActual ? ` · ${articuloActual.unidad}` : ""}
            </label>
            <input
              id="cantidad"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              className={fieldClass}
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={agregarLinea}
            disabled={!articuloActual || Number(cantidad) <= 0}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconPlus />
            Agregar
          </button>
        </div>
      </SectionCard>

      <SectionCard
        step={3}
        title="Detalle del pedido"
        description="Revisa las líneas antes de enviar."
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-muted px-2.5 py-1 font-semibold text-muted-foreground">
            {lineas.length} {lineas.length === 1 ? "artículo" : "artículos"}
          </span>
          {lineas.length > 0 && (
            <span className="rounded-full bg-muted px-2.5 py-1 font-semibold text-muted-foreground">
              {totalUnidades.toLocaleString("es-CL")} unidades en total
            </span>
          )}
        </div>

        {lineas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            Aún no has agregado artículos.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold">Código</th>
                  <th className="py-2 pr-3 font-semibold">Artículo</th>
                  <th className="hidden py-2 pr-3 font-semibold sm:table-cell">
                    Categoría
                  </th>
                  <th className="py-2 pr-3 text-right font-semibold">Cantidad</th>
                  <th className="py-2 font-semibold">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => (
                  <tr
                    key={l.codigo}
                    className="border-b border-border/70 last:border-0"
                  >
                    <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">
                      {l.codigo}
                    </td>
                    <td className="py-2.5 pr-3 font-medium text-card-foreground">
                      {l.nombre}
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground sm:hidden">
                        {l.categoria}
                      </span>
                    </td>
                    <td className="hidden py-2.5 pr-3 text-muted-foreground sm:table-cell">
                      {l.categoria}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">
                      {l.cantidad.toLocaleString("es-CL")}{" "}
                      <span className="font-normal text-muted-foreground">
                        {l.unidad}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => quitarLinea(l.codigo)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10"
                        aria-label={`Quitar ${l.nombre}`}
                      >
                        <IconTrash />
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={enviarPedido}
            disabled={!puedeEnviar}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-6 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enviando ? "Enviando…" : "Enviar Pedido"}
          </button>
          {!solicitante.trim() && lineas.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Ingresa el solicitante para enviar.
            </span>
          )}
        </div>

        {resultado?.ok && (
          <div
            role="status"
            className="mt-4 flex items-start gap-2.5 rounded-lg border border-success/30 bg-success-surface p-3.5 text-sm text-success"
          >
            <span className="mt-0.5 shrink-0">
              <IconCheck />
            </span>
            <span>
              Pedido enviado correctamente. Folio:{" "}
              <span className="font-mono font-bold">{resultado.pedidoId}</span>
            </span>
          </div>
        )}
        {resultado && !resultado.ok && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3.5 text-sm text-destructive"
          >
            {resultado.error}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
