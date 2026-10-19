"use client";

import { useEffect, useMemo, useState } from "react";
import SearchCombobox, { type ComboOption } from "./SearchCombobox";

type PedidoItem = {
  nombre: string;
  unidad: string;
  cantidad: number;
  cantidadRecibida: number | null;
  fechaRecepcionBodega: string;
  fechaEntregaSolicitante: string;
  comentarioArticulo: string;
};

type Pedido = {
  pedidoId: string;
  fecha: string;
  solicitante: string;
  area: string;
  centroNegocio: string;
  centroCodigo: string;
  fechaEntrega: string;
  despacho: string;
  comentario: string;
  urgente: boolean;
  items: PedidoItem[];
};

type Estado = "pendiente" | "parcial" | "completo";

const ESTADOS: Record<Estado, { label: string; chip: string }> = {
  pendiente: { label: "Pendiente", chip: "bg-warning-surface text-warning" },
  parcial: { label: "Parcial", chip: "bg-accent/10 text-accent" },
  completo: { label: "Completo", chip: "bg-success-surface text-success" },
};

const STORAGE_KEY = "mis-pedidos:solicitante";

function estadoLinea(it: PedidoItem): Estado {
  if (it.cantidadRecibida === null) return "pendiente";
  return it.cantidadRecibida >= it.cantidad ? "completo" : "parcial";
}

function estadoPedido(items: PedidoItem[]): Estado {
  if (items.length === 0 || items.every((it) => it.cantidadRecibida === null))
    return "pendiente";
  return items.every((it) => estadoLinea(it) === "completo")
    ? "completo"
    : "parcial";
}

function formatFecha(s: string): string {
  if (!s) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function Dato({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-card-foreground">{children}</dd>
    </div>
  );
}

export default function MisPedidosPanel() {
  const [nombres, setNombres] = useState<ComboOption[]>([]);
  const [solicitante, setSolicitante] = useState("");
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lista de personas del maestro de empleados.
  useEffect(() => {
    let cancelado = false;
    fetch("/api/solicitantes")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelado && Array.isArray(d?.solicitantes)) {
          setNombres(
            (d.solicitantes as string[]).map((n) => ({ value: n, label: n }))
          );
          // Recuerda el último nombre usado en este navegador.
          try {
            const guardado = localStorage.getItem(STORAGE_KEY);
            if (guardado) {
              setSolicitante(guardado);
              cargar(guardado);
            }
          } catch {}
        }
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, []);

  function elegir(nombre: string) {
    setSolicitante(nombre);
    if (nombre) cargar(nombre);
    try {
      if (nombre) localStorage.setItem(STORAGE_KEY, nombre);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  async function cargar(nombre: string) {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pedidos?solicitante=${encodeURIComponent(nombre)}`,
        { cache: "no-store" }
      );
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar pedidos");
      setPedidos(data.pedidos ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setCargando(false);
    }
  }

  const lista = useMemo(
    () => (solicitante ? pedidos : []),
    [solicitante, pedidos]
  );

  const conteo = useMemo(() => {
    const c: Record<Estado, number> = { pendiente: 0, parcial: 0, completo: 0 };
    for (const p of lista) c[estadoPedido(p.items)] += 1;
    return c;
  }, [lista]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <label className="block max-w-md">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Solicitante
          </span>
          <SearchCombobox
            ariaLabel="Solicitante"
            clearable
            placeholder="Escribe tu nombre…"
            options={nombres}
            value={solicitante}
            onChange={elegir}
          />
        </label>
        {solicitante && !cargando && !error && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {lista.length} pedido{lista.length === 1 ? "" : "s"}
            </span>
            {(Object.keys(ESTADOS) as Estado[]).map((e) => (
              <span
                key={e}
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADOS[e].chip}`}
              >
                {conteo[e]} {ESTADOS[e].label.toLowerCase()}
                {conteo[e] === 1 ? "" : "s"}
              </span>
            ))}
            <button
              type="button"
              onClick={() => cargar(solicitante)}
              className="ml-auto inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted"
            >
              Actualizar
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      {cargando && (
        <p className="text-sm text-muted-foreground">Cargando pedidos…</p>
      )}
      {!solicitante && (
        <p className="text-sm text-muted-foreground">
          Elige tu nombre para ver tus pedidos.
        </p>
      )}
      {solicitante && !cargando && !error && lista.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No hay pedidos registrados a nombre de {solicitante}.
        </p>
      )}

      <ul className="space-y-3">
        {lista.map((p) => {
          const estado = ESTADOS[estadoPedido(p.items)];
          return (
            <li
              key={p.pedidoId}
              className="rounded-xl border border-border bg-card shadow-sm"
            >
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                  <span className="text-sm font-extrabold text-primary">
                    {p.pedidoId}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${estado.chip}`}
                  >
                    {estado.label}
                  </span>
                  {p.urgente && (
                    <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold text-destructive">
                      Urgente
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {p.centroNegocio || p.centroCodigo}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatFecha(p.fecha)} · {p.items.length} artículo
                    {p.items.length === 1 ? "" : "s"}
                  </span>
                </summary>

                <div className="border-t border-border px-4 py-3">
                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Dato label="Área">{p.area || "—"}</Dato>
                    <Dato label="Despacho">{p.despacho || "—"}</Dato>
                    <Dato label="Entrega solicitada">
                      {formatFecha(p.fechaEntrega)}
                    </Dato>
                    <Dato label="Comentario">{p.comentario || "—"}</Dato>
                  </dl>

                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead>
                        <tr className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          <th className="py-1.5 pr-3">Artículo</th>
                          <th className="px-3 py-1.5">Pedido</th>
                          <th className="px-3 py-1.5">Recibido</th>
                          <th className="px-3 py-1.5">Estado</th>
                          <th className="py-1.5 pl-3">Entregado a ti</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.items.map((it, i) => {
                          const e = ESTADOS[estadoLinea(it)];
                          return (
                            <tr
                              key={i}
                              className="border-t border-border align-top"
                            >
                              <td className="py-2 pr-3">
                                {it.nombre}
                                {it.comentarioArticulo && (
                                  <span className="block text-xs text-muted-foreground">
                                    {it.comentarioArticulo}
                                  </span>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2">
                                {it.cantidad.toLocaleString("es-CL")}{" "}
                                {it.unidad}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2">
                                {it.cantidadRecibida === null
                                  ? "—"
                                  : `${it.cantidadRecibida.toLocaleString("es-CL")} ${it.unidad}`}
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`rounded-full px-2 py-px text-[11px] font-semibold ${e.chip}`}
                                >
                                  {e.label}
                                </span>
                              </td>
                              <td className="whitespace-nowrap py-2 pl-3">
                                {formatFecha(it.fechaEntregaSolicitante)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
