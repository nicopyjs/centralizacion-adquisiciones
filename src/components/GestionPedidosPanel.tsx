"use client";

import { useEffect, useMemo, useState } from "react";

type PedidoItem = {
  fila: number;
  categoria: string;
  codigo: string;
  nombre: string;
  unidad: string;
  cantidad: number;
  cantidadRecibida: number | null;
  consumoInterno: string;
  parteDeEntrada: string;
};

type PedidoResumen = {
  pedidoId: string;
  fecha: string;
  solicitante: string;
  area: string;
  centroNegocio: string;
  centroCodigo: string;
  fechaEntrega: string;
  clasificador1: string;
  clasificador2: string;
  despacho: string;
  comentario: string;
  items: PedidoItem[];
};

const fieldClass =
  "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-card-foreground shadow-sm outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const labelClass =
  "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

function formatFecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function estadoPedido(items: PedidoItem[]): {
  label: string;
  className: string;
} {
  if (items.length === 0) {
    return { label: "Sin artículos", className: "bg-muted text-muted-foreground" };
  }
  const recibidos = items.filter((it) => it.cantidadRecibida !== null);
  if (recibidos.length === 0) {
    return {
      label: "Pendiente",
      className: "bg-warning-surface text-warning",
    };
  }
  const completo = items.every(
    (it) => it.cantidadRecibida !== null && it.cantidadRecibida >= it.cantidad
  );
  if (completo) {
    return { label: "Completo", className: "bg-success/10 text-success" };
  }
  return {
    label: "Parcial",
    className: "bg-accent/10 text-accent",
  };
}

// Estado editable de una línea: strings para poder dejar el input vacío
// mientras se escribe, sin forzar 0.
type LineaEdit = {
  cantidadRecibida: string;
  consumoInterno: string;
  parteDeEntrada: string;
};

function lineaEditDesdeItem(it: PedidoItem): LineaEdit {
  return {
    cantidadRecibida:
      it.cantidadRecibida === null ? "" : String(it.cantidadRecibida),
    consumoInterno: it.consumoInterno,
    parteDeEntrada: it.parteDeEntrada,
  };
}

export default function GestionPedidosPanel() {
  const [pedidos, setPedidos] = useState<PedidoResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [seleccionado, setSeleccionado] = useState<string | null>(null);

  const [ediciones, setEdiciones] = useState<Record<number, LineaEdit>>({});
  const [guardando, setGuardando] = useState<Record<number, boolean>>({});
  const [guardado, setGuardado] = useState<Record<number, boolean>>({});
  const [errores, setErrores] = useState<Record<number, string>>({});

  async function cargarPedidos() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/pedidos", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar pedidos");
      setPedidos(data.pedidos ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargarPedidos();
  }, []);

  const pedidosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return pedidos;
    return pedidos.filter((p) =>
      [p.pedidoId, p.solicitante, p.area, p.centroNegocio]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [pedidos, busqueda]);

  const pedidoActual = useMemo(
    () => pedidos.find((p) => p.pedidoId === seleccionado) ?? null,
    [pedidos, seleccionado]
  );

  function abrirPedido(p: PedidoResumen) {
    setSeleccionado(p.pedidoId);
    const nuevas: Record<number, LineaEdit> = {};
    for (const it of p.items) nuevas[it.fila] = lineaEditDesdeItem(it);
    setEdiciones(nuevas);
    setGuardado({});
    setErrores({});
  }

  function cambiarCampo(fila: number, campo: keyof LineaEdit, valor: string) {
    setEdiciones((prev) => ({
      ...prev,
      [fila]: { ...prev[fila], [campo]: valor },
    }));
    setGuardado((prev) => ({ ...prev, [fila]: false }));
  }

  async function guardarLinea(fila: number) {
    const edicion = ediciones[fila];
    if (!edicion) return;

    const cantidadRecibida =
      edicion.cantidadRecibida.trim() === ""
        ? null
        : Number(edicion.cantidadRecibida);
    if (cantidadRecibida !== null && !Number.isFinite(cantidadRecibida)) {
      setErrores((prev) => ({ ...prev, [fila]: "Cantidad inválida." }));
      return;
    }

    setGuardando((prev) => ({ ...prev, [fila]: true }));
    setErrores((prev) => ({ ...prev, [fila]: "" }));
    try {
      const res = await fetch("/api/pedidos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fila,
          cantidadRecibida,
          consumoInterno: edicion.consumoInterno.trim(),
          parteDeEntrada: edicion.parteDeEntrada.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar.");

      setPedidos((prev) =>
        prev.map((p) => ({
          ...p,
          items: p.items.map((it) =>
            it.fila === fila
              ? {
                  ...it,
                  cantidadRecibida,
                  consumoInterno: edicion.consumoInterno.trim(),
                  parteDeEntrada: edicion.parteDeEntrada.trim(),
                }
              : it
          ),
        }))
      );
      setGuardado((prev) => ({ ...prev, [fila]: true }));
      window.setTimeout(
        () => setGuardado((prev) => ({ ...prev, [fila]: false })),
        2500
      );
    } catch (err) {
      setErrores((prev) => ({
        ...prev,
        [fila]: err instanceof Error ? err.message : "Error de red.",
      }));
    } finally {
      setGuardando((prev) => ({ ...prev, [fila]: false }));
    }
  }

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">Cargando pedidos…</span>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-xl border border-border bg-muted/50"
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
        <p className="font-semibold">No se pudieron cargar los pedidos.</p>
        <p className="mt-1">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-primary">
              Pedidos registrados
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {pedidos.length} {pedidos.length === 1 ? "pedido" : "pedidos"} en
              la planilla. Haz clic en uno para ver el detalle.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              className={`${fieldClass} w-56`}
              placeholder="Buscar por folio, solicitante, área…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            <button
              type="button"
              onClick={cargarPedidos}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted"
            >
              Actualizar
            </button>
          </div>
        </div>

        {pedidosFiltrados.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No hay pedidos que coincidan con la búsqueda.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold">Folio</th>
                  <th className="py-2 pr-3 font-semibold">Fecha</th>
                  <th className="py-2 pr-3 font-semibold">Solicitante</th>
                  <th className="py-2 pr-3 font-semibold">Área</th>
                  <th className="py-2 pr-3 font-semibold">Centro de negocio</th>
                  <th className="py-2 pr-3 font-semibold">Artículos</th>
                  <th className="py-2 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {pedidosFiltrados.map((p) => {
                  const estado = estadoPedido(p.items);
                  const activo = p.pedidoId === seleccionado;
                  return (
                    <tr
                      key={p.pedidoId}
                      onClick={() => abrirPedido(p)}
                      className={`cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-muted/60 ${
                        activo ? "bg-accent/10" : ""
                      }`}
                    >
                      <td className="py-2.5 pr-3 font-semibold text-primary">
                        {p.pedidoId}
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">
                        {formatFecha(p.fecha)}
                      </td>
                      <td className="py-2.5 pr-3">{p.solicitante}</td>
                      <td className="py-2.5 pr-3">{p.area || "—"}</td>
                      <td className="py-2.5 pr-3">{p.centroNegocio || "—"}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">
                        {p.items.length}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${estado.className}`}
                        >
                          {estado.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {pedidoActual && (
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-primary">
                Detalle del pedido {pedidoActual.pedidoId}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Ingresa la cantidad recibida (puede ser menor a la pedida), el
                consumo interno y el parte de entrada, y guarda por fila.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSeleccionado(null)}
              className="text-xs font-semibold text-muted-foreground hover:text-primary"
            >
              Cerrar
            </button>
          </div>

          <div className="mt-4 grid gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm sm:grid-cols-3">
            <div>
              <span className={labelClass}>Solicitante</span>
              {pedidoActual.solicitante || "—"}
            </div>
            <div>
              <span className={labelClass}>Fecha del pedido</span>
              {formatFecha(pedidoActual.fecha)}
            </div>
            <div>
              <span className={labelClass}>Fecha de entrega</span>
              {pedidoActual.fechaEntrega || "—"}
            </div>
            <div>
              <span className={labelClass}>Área</span>
              {pedidoActual.area || "—"}
            </div>
            <div>
              <span className={labelClass}>Centro de negocio</span>
              {pedidoActual.centroNegocio || "—"}{" "}
              {pedidoActual.centroCodigo && (
                <span className="text-muted-foreground">
                  ({pedidoActual.centroCodigo})
                </span>
              )}
            </div>
            <div>
              <span className={labelClass}>Despacho</span>
              {pedidoActual.despacho || "—"}
            </div>
            <div>
              <span className={labelClass}>Clasificador 1</span>
              {pedidoActual.clasificador1 || "—"}
            </div>
            <div>
              <span className={labelClass}>Clasificador 2</span>
              {pedidoActual.clasificador2 || "—"}
            </div>
            <div>
              <span className={labelClass}>Comentario</span>
              {pedidoActual.comentario || "—"}
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold">Categoría</th>
                  <th className="py-2 pr-3 font-semibold">Artículo</th>
                  <th className="py-2 pr-3 font-semibold">Pedido</th>
                  <th className="py-2 pr-3 font-semibold">Recibido</th>
                  <th className="py-2 pr-3 font-semibold">Consumo interno</th>
                  <th className="py-2 pr-3 font-semibold">Parte de entrada</th>
                  <th className="py-2 font-semibold">
                    <span className="sr-only">Guardar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pedidoActual.items.map((it) => {
                  const edicion = ediciones[it.fila] ?? lineaEditDesdeItem(it);
                  const cantRecibidaNum =
                    edicion.cantidadRecibida.trim() === ""
                      ? null
                      : Number(edicion.cantidadRecibida);
                  const bajoLoPedido =
                    cantRecibidaNum !== null && cantRecibidaNum < it.cantidad;
                  return (
                    <tr
                      key={it.fila}
                      className="border-b border-border/70 align-top last:border-0"
                    >
                      <td className="py-2.5 pr-3 text-muted-foreground">
                        {it.categoria}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-card-foreground">
                          {it.nombre}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {it.codigo}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums">
                        {it.cantidad.toLocaleString("es-CL")} {it.unidad}
                      </td>
                      <td className="py-2.5 pr-3">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          className={`${fieldClass} h-9 w-24 ${
                            bajoLoPedido ? "border-warning" : ""
                          }`}
                          placeholder="—"
                          value={edicion.cantidadRecibida}
                          onChange={(e) =>
                            cambiarCampo(
                              it.fila,
                              "cantidadRecibida",
                              e.target.value
                            )
                          }
                        />
                        {bajoLoPedido && (
                          <p className="mt-1 text-xs text-warning">
                            Menor a lo pedido
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <input
                          className={`${fieldClass} h-9 w-36`}
                          value={edicion.consumoInterno}
                          onChange={(e) =>
                            cambiarCampo(it.fila, "consumoInterno", e.target.value)
                          }
                          placeholder="Opcional"
                        />
                      </td>
                      <td className="py-2.5 pr-3">
                        <input
                          className={`${fieldClass} h-9 w-36`}
                          value={edicion.parteDeEntrada}
                          onChange={(e) =>
                            cambiarCampo(it.fila, "parteDeEntrada", e.target.value)
                          }
                          placeholder="Opcional"
                        />
                      </td>
                      <td className="py-2.5">
                        <button
                          type="button"
                          onClick={() => guardarLinea(it.fila)}
                          disabled={guardando[it.fila]}
                          className="inline-flex h-9 items-center justify-center rounded-lg bg-accent px-3 text-xs font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {guardando[it.fila]
                            ? "Guardando…"
                            : guardado[it.fila]
                              ? "Guardado ✓"
                              : "Guardar"}
                        </button>
                        {errores[it.fila] && (
                          <p className="mt-1 text-xs text-destructive">
                            {errores[it.fila]}
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
