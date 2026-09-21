"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SearchCombobox, { type ComboOption } from "./SearchCombobox";

type PedidoItem = {
  fila: number;
  categoria: string;
  codigo: string;
  nombre: string;
  unidad: string;
  cantidad: number;
  cantidadRecibida: number | null;
  consumoInterno: string;
  recepcionadoPor: string;
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
  urgente: boolean;
  items: PedidoItem[];
};

type Estado = "pendiente" | "parcial" | "completo";
type Filtro = "todos" | "urgentes" | Estado;

const ESTADOS: Record<Estado, { label: string; chip: string; dot: string }> = {
  pendiente: {
    label: "Pendiente",
    chip: "bg-warning-surface text-warning",
    dot: "bg-warning",
  },
  parcial: {
    label: "Parcial",
    chip: "bg-accent/10 text-accent",
    dot: "bg-accent",
  },
  completo: {
    label: "Completo",
    chip: "bg-success-surface text-success",
    dot: "bg-success",
  },
};

const fieldClass =
  "h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-card-foreground shadow-sm outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const labelClass =
  "mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
const cardClass = "rounded-xl border border-border bg-card shadow-sm";

function formatFecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

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

/** Urgente y todavía sin recibir por completo: lo que hay que atender primero. */
function esUrgentePendiente(p: PedidoResumen): boolean {
  return p.urgente && estadoPedido(p.items) !== "completo";
}

// Estado editable de una línea: strings para poder dejar el input vacío
// mientras se escribe, sin forzar 0.
type LineaEdit = {
  cantidadRecibida: string;
  consumoInterno: string;
  recepcionadoPor: string;
};

function lineaEditDesdeItem(it: PedidoItem): LineaEdit {
  return {
    cantidadRecibida:
      it.cantidadRecibida === null ? "" : String(it.cantidadRecibida),
    consumoInterno: it.consumoInterno,
    recepcionadoPor: it.recepcionadoPor,
  };
}

/** ¿Lo escrito en la fila difiere de lo que hay guardado en la planilla? */
function tieneCambios(it: PedidoItem, ed: LineaEdit | undefined): boolean {
  if (!ed) return false;
  const base = lineaEditDesdeItem(it);
  return (
    ed.cantidadRecibida.trim() !== base.cantidadRecibida ||
    ed.consumoInterno.trim() !== base.consumoInterno.trim() ||
    ed.recepcionadoPor.trim() !== base.recepcionadoPor.trim()
  );
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export default function GestionPedidosPanel() {
  const [pedidos, setPedidos] = useState<PedidoResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [seleccionado, setSeleccionado] = useState<string | null>(null);

  // Solo las filas que el usuario tocó; el resto se lee de `pedidos`.
  const [ediciones, setEdiciones] = useState<Record<number, LineaEdit>>({});
  const [guardando, setGuardando] = useState<Record<number, boolean>>({});
  const [guardado, setGuardado] = useState<Record<number, boolean>>({});
  const [errores, setErrores] = useState<Record<number, string>>({});
  const [guardandoTodo, setGuardandoTodo] = useState(false);

  const detalleRef = useRef<HTMLElement>(null);

  async function cargarPedidos(inicial = false) {
    if (!inicial) setRefrescando(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/pedidos", { cache: "no-store" });
      if (res.status === 401) {
        // Sesión vencida: la página vuelve a pedir la contraseña.
        window.location.reload();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar pedidos");
      const lista: PedidoResumen[] = data.pedidos ?? [];
      setPedidos(lista);
      // Deja abierto un pedido para no partir con la pantalla vacía: el primer
      // urgente pendiente si hay, si no el más reciente.
      setSeleccionado((prev) =>
        prev && lista.some((p) => p.pedidoId === prev)
          ? prev
          : ((lista.find(esUrgentePendiente) ?? lista[0])?.pedidoId ?? null)
      );
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
      setRefrescando(false);
    }
  }

  useEffect(() => {
    cargarPedidos(true);
  }, []);

  // Personas activas del maestro de empleados, para «Recepcionado por». Es
  // opcional: si falla, el campo sigue aceptando texto libre.
  const [empleados, setEmpleados] = useState<ComboOption[]>([]);
  useEffect(() => {
    let cancelado = false;
    fetch("/api/solicitantes")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelado && Array.isArray(d?.solicitantes)) {
          setEmpleados(
            (d.solicitantes as string[]).map((n) => ({ value: n, label: n }))
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, []);

  const cambiosPorPedido = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pedidos) {
      const n = p.items.filter((it) => tieneCambios(it, ediciones[it.fila]))
        .length;
      if (n > 0) m.set(p.pedidoId, n);
    }
    return m;
  }, [pedidos, ediciones]);

  const totalCambios = useMemo(
    () => Array.from(cambiosPorPedido.values()).reduce((a, b) => a + b, 0),
    [cambiosPorPedido]
  );

  // Avisa antes de cerrar la pestaña si hay filas editadas sin guardar.
  useEffect(() => {
    if (totalCambios === 0) return;
    function avisar(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [totalCambios]);

  const conteo = useMemo(() => {
    const c: Record<Filtro, number> = {
      todos: pedidos.length,
      urgentes: 0,
      pendiente: 0,
      parcial: 0,
      completo: 0,
    };
    for (const p of pedidos) {
      c[estadoPedido(p.items)] += 1;
      if (esUrgentePendiente(p)) c.urgentes += 1;
    }
    return c;
  }, [pedidos]);

  const pedidosFiltrados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return pedidos
      .filter((p) => {
        if (filtro === "urgentes") {
          if (!esUrgentePendiente(p)) return false;
        } else if (filtro !== "todos" && estadoPedido(p.items) !== filtro) {
          return false;
        }
        if (!q) return true;
        const texto = [
          p.pedidoId,
          p.solicitante,
          p.area,
          p.centroNegocio,
          ...p.items.flatMap((it) => [it.nombre, it.codigo]),
        ].join(" ");
        return normalizar(texto).includes(q);
      })
      // Los urgentes pendientes van primero (el orden sigue siendo por fecha,
      // del más reciente al más antiguo, dentro de cada grupo).
      .sort(
        (a, b) => Number(esUrgentePendiente(b)) - Number(esUrgentePendiente(a))
      );
  }, [pedidos, busqueda, filtro]);

  const pedidoActual = useMemo(
    () => pedidos.find((p) => p.pedidoId === seleccionado) ?? null,
    [pedidos, seleccionado]
  );

  function abrirPedido(p: PedidoResumen) {
    setSeleccionado(p.pedidoId);
    // En pantallas angostas el detalle queda debajo de la lista.
    if (window.innerWidth < 1024) {
      window.setTimeout(
        () => detalleRef.current?.scrollIntoView({ behavior: "smooth" }),
        0
      );
    }
  }

  function cambiarCampo(
    it: PedidoItem,
    campo: keyof LineaEdit,
    valor: string
  ) {
    setEdiciones((prev) => ({
      ...prev,
      [it.fila]: { ...(prev[it.fila] ?? lineaEditDesdeItem(it)), [campo]: valor },
    }));
    setGuardado((prev) => ({ ...prev, [it.fila]: false }));
  }

  function marcarRecibido(items: PedidoItem[]) {
    setEdiciones((prev) => {
      const next = { ...prev };
      for (const it of items) {
        next[it.fila] = {
          ...(prev[it.fila] ?? lineaEditDesdeItem(it)),
          cantidadRecibida: String(it.cantidad),
        };
      }
      return next;
    });
  }

  async function guardarLinea(it: PedidoItem): Promise<boolean> {
    const edicion = ediciones[it.fila];
    if (!edicion) return true;
    const fila = it.fila;

    const cantidadRecibida =
      edicion.cantidadRecibida.trim() === ""
        ? null
        : Number(edicion.cantidadRecibida);
    if (cantidadRecibida !== null && !Number.isFinite(cantidadRecibida)) {
      setErrores((prev) => ({ ...prev, [fila]: "Cantidad inválida." }));
      return false;
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
          recepcionadoPor: edicion.recepcionadoPor.trim(),
        }),
      });
      if (res.status === 401) {
        window.location.reload();
        return false;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar.");

      setPedidos((prev) =>
        prev.map((p) => ({
          ...p,
          items: p.items.map((x) =>
            x.fila === fila
              ? {
                  ...x,
                  cantidadRecibida,
                  consumoInterno: edicion.consumoInterno.trim(),
                  recepcionadoPor: edicion.recepcionadoPor.trim(),
                }
              : x
          ),
        }))
      );
      setEdiciones((prev) => {
        const next = { ...prev };
        delete next[fila];
        return next;
      });
      setGuardado((prev) => ({ ...prev, [fila]: true }));
      window.setTimeout(
        () => setGuardado((prev) => ({ ...prev, [fila]: false })),
        2500
      );
      return true;
    } catch (err) {
      setErrores((prev) => ({
        ...prev,
        [fila]: err instanceof Error ? err.message : "Error de red.",
      }));
      return false;
    } finally {
      setGuardando((prev) => ({ ...prev, [fila]: false }));
    }
  }

  async function guardarTodo(p: PedidoResumen) {
    setGuardandoTodo(true);
    try {
      for (const it of p.items) {
        if (tieneCambios(it, ediciones[it.fila])) await guardarLinea(it);
      }
    } finally {
      setGuardandoTodo(false);
    }
  }

  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-4">
        <span className="sr-only">Cargando pedidos…</span>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[72px] animate-pulse rounded-xl border border-border bg-muted/50"
            />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="h-96 animate-pulse rounded-xl border border-border bg-muted/50" />
          <div className="h-96 animate-pulse rounded-xl border border-border bg-muted/50" />
        </div>
      </div>
    );
  }

  if (loadError && pedidos.length === 0) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-warning/40 bg-warning-surface p-5 text-sm text-warning"
      >
        <p className="font-semibold">No se pudieron cargar los pedidos.</p>
        <p className="mt-1">{loadError}</p>
        <button
          type="button"
          onClick={() => cargarPedidos()}
          className="mt-3 inline-flex h-9 items-center rounded-lg border border-warning/40 bg-card px-3 text-sm font-semibold text-warning hover:bg-muted"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const filtros: { key: Filtro; label: string; tono: string }[] = [
    { key: "todos", label: "Todos", tono: "bg-primary" },
    { key: "urgentes", label: "Urgentes", tono: "bg-destructive" },
    { key: "pendiente", label: "Pendientes", tono: ESTADOS.pendiente.dot },
    { key: "parcial", label: "Parciales", tono: ESTADOS.parcial.dot },
    { key: "completo", label: "Completos", tono: ESTADOS.completo.dot },
  ];

  return (
    <div className="space-y-4">
      {/* Resumen (sirve también como filtro) + búsqueda */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-stretch">
        <div
          role="group"
          aria-label="Filtrar por estado"
          className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        >
          {filtros.map((f) => {
            const activo = filtro === f.key;
            // «Urgentes» se marca en rojo cuando hay alguno pendiente.
            const alerta = f.key === "urgentes" && conteo.urgentes > 0;
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={activo}
                onClick={() => setFiltro(f.key)}
                className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left shadow-sm transition-colors ${
                  activo
                    ? alerta
                      ? "border-destructive bg-destructive/5 ring-1 ring-destructive"
                      : "border-accent bg-accent/5 ring-1 ring-accent"
                    : alerta
                      ? "border-destructive/40 bg-destructive/5 hover:bg-destructive/10"
                      : "border-border bg-card hover:bg-muted/60"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-secondary">
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 rounded-full ${f.tono}`}
                  />
                  {f.label}
                </span>
                <span
                  className={`text-2xl font-extrabold tabular-nums ${
                    alerta ? "text-destructive" : "text-primary"
                  }`}
                >
                  {conteo[f.key]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 xl:w-[440px]">
          <div className="relative min-w-0 flex-1">
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              <IconSearch />
            </span>
            <input
              type="search"
              aria-label="Buscar pedidos"
              className={`${fieldClass} h-11 pl-9`}
              placeholder="Buscar folio, solicitante, centro, artículo…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => cargarPedidos()}
            disabled={refrescando}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted disabled:opacity-60"
          >
            <span className={refrescando ? "animate-spin" : ""}>
              <IconRefresh />
            </span>
            {refrescando ? "Actualizando" : "Actualizar"}
          </button>
        </div>
      </div>

      {loadError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          No se pudo actualizar: {loadError}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)]">
        {/* Lista de pedidos */}
        <section
          aria-label="Pedidos registrados"
          className={`${cardClass} flex flex-col overflow-hidden lg:sticky lg:top-20 lg:max-h-[calc(100vh-7rem)]`}
        >
          <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-bold text-primary">Pedidos</h2>
            <span className="text-xs text-muted-foreground">
              {pedidosFiltrados.length} de {pedidos.length}
            </span>
          </div>

          {pedidosFiltrados.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              {pedidos.length === 0
                ? "Aún no hay pedidos registrados."
                : "Ningún pedido coincide con el filtro."}
            </div>
          ) : (
            <ul className="divide-y divide-border/70 overflow-y-auto">
              {pedidosFiltrados.map((p) => {
                const estado = ESTADOS[estadoPedido(p.items)];
                const activo = p.pedidoId === seleccionado;
                const completas = p.items.filter(
                  (it) => estadoLinea(it) === "completo"
                ).length;
                const sinGuardar = cambiosPorPedido.get(p.pedidoId) ?? 0;
                const urgentePend = esUrgentePendiente(p);
                return (
                  <li key={p.pedidoId}>
                    <button
                      type="button"
                      onClick={() => abrirPedido(p)}
                      aria-current={activo ? "true" : undefined}
                      className={`block w-full border-l-4 px-4 py-3 text-left transition-colors ${
                        urgentePend
                          ? activo
                            ? "border-l-destructive bg-destructive/10"
                            : "border-l-destructive bg-destructive/5 hover:bg-destructive/10"
                          : activo
                            ? "border-l-accent bg-accent/5"
                            : "border-l-transparent hover:bg-muted/60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="text-sm font-bold text-primary">
                            {p.pedidoId}
                          </span>
                          {p.urgente && (
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${
                                urgentePend
                                  ? "bg-destructive text-destructive-foreground"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              Urgente
                            </span>
                          )}
                        </span>
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${estado.chip}`}
                        >
                          {estado.label}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-sm text-card-foreground">
                        {p.solicitante || "—"}
                        <span className="text-muted-foreground">
                          {" · "}
                          {p.area || "—"}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {p.centroNegocio || "—"}
                      </div>
                      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{formatFecha(p.fecha)}</span>
                        <span className="flex flex-1 items-center gap-2">
                          <span
                            aria-hidden
                            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                          >
                            <span
                              className="block h-full rounded-full bg-success transition-[width]"
                              style={{
                                width: `${
                                  p.items.length
                                    ? (completas / p.items.length) * 100
                                    : 0
                                }%`,
                              }}
                            />
                          </span>
                          <span className="tabular-nums">
                            {completas}/{p.items.length} recibidos
                          </span>
                        </span>
                      </div>
                      {sinGuardar > 0 && (
                        <div className="mt-1.5 text-xs font-semibold text-warning">
                          ● {sinGuardar}{" "}
                          {sinGuardar === 1 ? "cambio" : "cambios"} sin guardar
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Detalle */}
        <section
          ref={detalleRef}
          aria-label="Detalle del pedido"
          className={`${cardClass} min-w-0 scroll-mt-24`}
        >
          {!pedidoActual ? (
            <div className="px-6 py-20 text-center">
              <p className="text-sm font-semibold text-primary">
                Selecciona un pedido
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Elige uno de la lista para ver sus artículos y registrar lo
                recibido.
              </p>
            </div>
          ) : (
            <Detalle
              pedido={pedidoActual}
              ediciones={ediciones}
              guardando={guardando}
              guardado={guardado}
              errores={errores}
              guardandoTodo={guardandoTodo}
              empleados={empleados}
              cambios={cambiosPorPedido.get(pedidoActual.pedidoId) ?? 0}
              onCambiar={cambiarCampo}
              onMarcarRecibido={marcarRecibido}
              onGuardarLinea={guardarLinea}
              onGuardarTodo={() => guardarTodo(pedidoActual)}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function Detalle({
  pedido,
  ediciones,
  guardando,
  guardado,
  errores,
  guardandoTodo,
  empleados,
  cambios,
  onCambiar,
  onMarcarRecibido,
  onGuardarLinea,
  onGuardarTodo,
}: {
  pedido: PedidoResumen;
  ediciones: Record<number, LineaEdit>;
  guardando: Record<number, boolean>;
  guardado: Record<number, boolean>;
  errores: Record<number, string>;
  guardandoTodo: boolean;
  empleados: ComboOption[];
  cambios: number;
  onCambiar: (it: PedidoItem, campo: keyof LineaEdit, valor: string) => void;
  onMarcarRecibido: (items: PedidoItem[]) => void;
  onGuardarLinea: (it: PedidoItem) => Promise<boolean>;
  onGuardarTodo: () => void;
}) {
  const estado = ESTADOS[estadoPedido(pedido.items)];
  const faltantes = pedido.items.filter((it) => {
    const ed = ediciones[it.fila];
    const rec =
      ed && ed.cantidadRecibida.trim() !== ""
        ? Number(ed.cantidadRecibida)
        : it.cantidadRecibida;
    return rec === null || rec < it.cantidad;
  });

  const datos: { label: string; valor: React.ReactNode; ancho?: boolean }[] = [
    { label: "Solicitante", valor: pedido.solicitante || "—" },
    { label: "Fecha del pedido", valor: formatFecha(pedido.fecha) },
    {
      label: "Fecha de entrega",
      valor: (
        <>
          {pedido.fechaEntrega || "—"}
          {pedido.urgente && (
            <span className="ml-2 rounded bg-destructive px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-destructive-foreground">
              Urgente
            </span>
          )}
        </>
      ),
    },
    { label: "Despacho", valor: pedido.despacho || "—" },
    { label: "Área", valor: pedido.area || "—" },
    {
      label: "Centro de negocio",
      valor: (
        <>
          {pedido.centroNegocio || "—"}
          {pedido.centroCodigo && (
            <span className="block text-xs text-muted-foreground">
              {pedido.centroCodigo}
            </span>
          )}
        </>
      ),
    },
    { label: "Clasificador 1", valor: pedido.clasificador1 || "—" },
    { label: "Clasificador 2", valor: pedido.clasificador2 || "—" },
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-extrabold tracking-tight text-primary">
              {pedido.pedidoId}
            </h2>
            {pedido.urgente && (
              <span className="rounded bg-destructive px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide text-destructive-foreground">
                Urgente
              </span>
            )}
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${estado.chip}`}
            >
              {estado.label}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pedido.items.length}{" "}
            {pedido.items.length === 1 ? "artículo" : "artículos"} · pedido el{" "}
            {formatFecha(pedido.fecha)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onMarcarRecibido(faltantes)}
            disabled={faltantes.length === 0}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconCheck />
            Marcar todo recibido
          </button>
          <button
            type="button"
            onClick={onGuardarTodo}
            disabled={cambios === 0 || guardandoTodo}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {guardandoTodo
              ? "Guardando…"
              : cambios > 0
                ? `Guardar cambios (${cambios})`
                : "Sin cambios"}
          </button>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-3 border-b border-border bg-muted/30 px-5 py-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        {datos.map((d) => (
          <div key={d.label} className="min-w-0">
            <dt className={labelClass}>{d.label}</dt>
            <dd className="break-words text-card-foreground">{d.valor}</dd>
          </div>
        ))}
        {pedido.comentario && (
          <div className="min-w-0 sm:col-span-2 xl:col-span-4">
            <dt className={labelClass}>Comentario</dt>
            <dd className="break-words text-card-foreground">
              {pedido.comentario}
            </dd>
          </div>
        )}
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2.5 pl-5 pr-3 font-semibold">Artículo</th>
              <th className="px-3 py-2.5 font-semibold">Pedido</th>
              <th className="px-3 py-2.5 font-semibold">Recibido</th>
              <th className="px-3 py-2.5 font-semibold">Consumo interno</th>
              <th className="px-3 py-2.5 font-semibold">Recepcionado por</th>
              <th className="py-2.5 pl-3 pr-5 text-right font-semibold">
                <span className="sr-only">Guardar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pedido.items.map((it) => {
              const edicion = ediciones[it.fila] ?? lineaEditDesdeItem(it);
              const sucia = tieneCambios(it, ediciones[it.fila]);
              const recNum =
                edicion.cantidadRecibida.trim() === ""
                  ? null
                  : Number(edicion.cantidadRecibida);
              const bajoLoPedido = recNum !== null && recNum < it.cantidad;
              const estadoIt = ESTADOS[estadoLinea(it)];
              const enter = (e: React.KeyboardEvent) => {
                if (e.key === "Enter" && sucia && !guardando[it.fila]) {
                  e.preventDefault();
                  void onGuardarLinea(it);
                }
              };
              return (
                <tr
                  key={it.fila}
                  className={`border-b border-border/70 align-top last:border-0 ${
                    sucia ? "bg-accent/5" : ""
                  }`}
                >
                  <td
                    className={`border-l-4 py-3 pl-4 pr-3 ${
                      sucia ? "border-l-accent" : "border-l-transparent"
                    }`}
                  >
                    <div className="font-medium text-card-foreground">
                      {it.nombre}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{it.codigo}</span>
                      {it.categoria && <span>· {it.categoria}</span>}
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-px text-[11px] font-semibold ${estadoIt.chip}`}
                      >
                        {estadoIt.label}
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                    <span className="text-base font-bold text-primary">
                      {it.cantidad.toLocaleString("es-CL")}
                    </span>{" "}
                    <span className="text-muted-foreground">{it.unidad}</span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        aria-label={`Cantidad recibida de ${it.nombre}`}
                        className={`${fieldClass} w-24 tabular-nums ${
                          bajoLoPedido ? "border-warning" : ""
                        }`}
                        placeholder="—"
                        value={edicion.cantidadRecibida}
                        onChange={(e) =>
                          onCambiar(it, "cantidadRecibida", e.target.value)
                        }
                        onKeyDown={enter}
                      />
                      <button
                        type="button"
                        title="Recibido completo"
                        aria-label={`Marcar ${it.nombre} como recibido completo`}
                        onClick={() =>
                          onCambiar(it, "cantidadRecibida", String(it.cantidad))
                        }
                        className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-secondary transition-colors hover:bg-muted"
                      >
                        Todo
                      </button>
                    </div>
                    {bajoLoPedido && (
                      <p className="mt-1 text-xs font-medium text-warning">
                        Menor a lo pedido
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <input
                      aria-label={`Consumo interno de ${it.nombre}`}
                      className={fieldClass}
                      value={edicion.consumoInterno}
                      onChange={(e) =>
                        onCambiar(it, "consumoInterno", e.target.value)
                      }
                      onKeyDown={enter}
                      placeholder="Opcional"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <SearchCombobox
                      size="sm"
                      allowCustom
                      clearable
                      ariaLabel={`Quién recepcionó ${it.nombre}`}
                      placeholder="Buscar persona…"
                      options={empleados}
                      value={edicion.recepcionadoPor}
                      onChange={(v) => onCambiar(it, "recepcionadoPor", v)}
                    />
                  </td>
                  <td className="whitespace-nowrap py-3 pl-3 pr-5 text-right">
                    <button
                      type="button"
                      onClick={() => void onGuardarLinea(it)}
                      disabled={!sucia || guardando[it.fila]}
                      className="inline-flex h-9 min-w-[92px] items-center justify-center rounded-lg bg-accent px-3 text-xs font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
                    >
                      {guardando[it.fila]
                        ? "Guardando…"
                        : guardado[it.fila]
                          ? "Guardado ✓"
                          : "Guardar"}
                    </button>
                    {errores[it.fila] && (
                      <p
                        role="alert"
                        className="mt-1 max-w-[140px] text-right text-xs text-destructive"
                      >
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
    </>
  );
}

function IconSearch() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      width="16"
      height="16"
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
