"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type PedidoItem = {
  categoria: string;
  codigo: string;
  nombre: string;
  unidad: string;
  cantidad: number;
  cantidadRecibida: number | null;
  recepcionadoPor: string;
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
  clasificador1: string;
  clasificador2: string;
  despacho: string;
  comentario: string;
  urgente: boolean;
  estadoManual?: "" | "cerrado" | "anulado";
  motivoEstado?: string;
  items: PedidoItem[];
};

type Estado = "pendiente" | "parcial" | "completo" | "cerrado" | "anulado";
type Vista = "todos" | Estado | "atrasados" | "urgentes";
type Orden = "recientes" | "antiguos" | "entrega" | "urgentes";

const ESTADOS: Record<Estado, { label: string; chip: string }> = {
  pendiente: { label: "Pendiente", chip: "bg-warning-surface text-warning" },
  parcial: { label: "Parcial", chip: "bg-accent/10 text-accent" },
  completo: { label: "Completo", chip: "bg-success-surface text-success" },
  cerrado: { label: "Cerrado", chip: "bg-muted text-secondary" },
  anulado: { label: "Anulado", chip: "bg-destructive/10 text-destructive" },
};

const POR_PAGINA = 40;

const fieldClass =
  "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-card-foreground shadow-sm outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40";
const labelClass =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

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

function estadoDe(p: Pedido): Estado {
  return p.estadoManual || estadoPedido(p.items);
}

function hoyYMD(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
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

function normaliza(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Pendiente o parcial con fecha de entrega solicitada ya vencida. */
function estaAtrasado(p: Pedido, hoy: string): boolean {
  const e = estadoDe(p);
  return (
    (e === "pendiente" || e === "parcial") &&
    /^\d{4}-\d{2}-\d{2}$/.test(p.fechaEntrega) &&
    p.fechaEntrega < hoy
  );
}

/** Clave de sessionStorage con la que se pasa un pedido a Enviar Pedido. */
const CLAVE_REPETIR = "repetirPedido";

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
  const router = useRouter();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const [vista, setVista] = useState<Vista>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [fSolicitante, setFSolicitante] = useState("");
  const [fCentro, setFCentro] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [orden, setOrden] = useState<Orden>("recientes");
  const [visibles, setVisibles] = useState(POR_PAGINA);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  // La API ya devuelve solo los pedidos del área de la sesión.
  useEffect(() => {
    let cancelado = false;
    fetch("/api/pedidos", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          window.location.reload();
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al cargar pedidos");
        if (!cancelado) {
          setPedidos(data.pedidos ?? []);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelado)
          setError(err instanceof Error ? err.message : "Error desconocido");
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [version]);

  function actualizar() {
    setCargando(true);
    setVersion((v) => v + 1);
  }

  const hoy = hoyYMD();

  const opciones = useMemo(() => {
    const unicos = (f: (p: Pedido) => string) =>
      Array.from(new Set(pedidos.map(f).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "es")
      );
    return {
      solicitantes: unicos((p) => p.solicitante),
      centros: unicos((p) => p.centroNegocio || p.centroCodigo),
    };
  }, [pedidos]);

  // Pedidos que pasan todos los filtros salvo la vista (estado): sobre ellos
  // se calculan los conteos de cada tarjeta.
  const base = useMemo(() => {
    const q = normaliza(busqueda.trim());
    return pedidos.filter((p) => {
      if (fSolicitante && p.solicitante !== fSolicitante) return false;
      if (fCentro && (p.centroNegocio || p.centroCodigo) !== fCentro)
        return false;
      const f = p.fecha.slice(0, 10);
      if (desde && f < desde) return false;
      if (hasta && f > hasta) return false;
      if (q) {
        const texto = normaliza(
          [
            p.pedidoId,
            p.solicitante,
            p.centroNegocio,
            p.centroCodigo,
            p.comentario,
            ...p.items.map((it) => it.nombre),
          ].join(" ")
        );
        if (!q.split(/\s+/).every((t) => texto.includes(t))) return false;
      }
      return true;
    });
  }, [pedidos, busqueda, fSolicitante, fCentro, desde, hasta]);

  const conteo = useMemo(() => {
    const c: Record<Vista, number> = {
      todos: base.length,
      pendiente: 0,
      parcial: 0,
      completo: 0,
      cerrado: 0,
      anulado: 0,
      atrasados: 0,
      urgentes: 0,
    };
    for (const p of base) {
      c[estadoDe(p)] += 1;
      if (estaAtrasado(p, hoy)) c.atrasados += 1;
      if (p.urgente) c.urgentes += 1;
    }
    return c;
  }, [base, hoy]);

  const lista = useMemo(() => {
    const filtrada = base.filter((p) => {
      if (vista === "todos") return true;
      if (vista === "atrasados") return estaAtrasado(p, hoy);
      if (vista === "urgentes") return p.urgente;
      return estadoDe(p) === vista;
    });
    const porFecha = (a: Pedido, b: Pedido) => b.fecha.localeCompare(a.fecha);
    return filtrada.sort((a, b) => {
      if (orden === "antiguos") return -porFecha(a, b);
      if (orden === "entrega") {
        // Sin fecha de entrega al final.
        const ea = a.fechaEntrega || "9999";
        const eb = b.fechaEntrega || "9999";
        return ea.localeCompare(eb) || porFecha(a, b);
      }
      if (orden === "urgentes")
        return Number(b.urgente) - Number(a.urgente) || porFecha(a, b);
      return porFecha(a, b);
    });
  }, [base, vista, orden, hoy]);

  const hayFiltros =
    vista !== "todos" ||
    busqueda !== "" ||
    fSolicitante !== "" ||
    fCentro !== "" ||
    desde !== "" ||
    hasta !== "";

  function limpiar() {
    setVista("todos");
    setBusqueda("");
    setFSolicitante("");
    setFCentro("");
    setDesde("");
    setHasta("");
    setVisibles(POR_PAGINA);
  }

  // Deja una copia del pedido en sessionStorage y abre Enviar Pedido, que la
  // consume para precargar el formulario.
  function repetir(p: Pedido) {
    try {
      sessionStorage.setItem(CLAVE_REPETIR, JSON.stringify(p));
    } catch {
      // Sin sessionStorage el formulario simplemente se abre vacío.
    }
    router.push("/enviar-pedido");
  }

  function alternar(id: string) {
    setAbiertos((prev) => {
      const sig = new Set(prev);
      if (sig.has(id)) sig.delete(id);
      else sig.add(id);
      return sig;
    });
  }

  const mostrados = lista.slice(0, visibles);
  const todosAbiertos =
    mostrados.length > 0 && mostrados.every((p) => abiertos.has(p.pedidoId));

  const TABS: { id: Vista; label: string; tono: string }[] = [
    { id: "todos", label: "Todos", tono: "" },
    { id: "pendiente", label: "Pendientes", tono: "text-warning" },
    { id: "parcial", label: "Parciales", tono: "text-accent" },
    { id: "completo", label: "Completos", tono: "text-success" },
    { id: "atrasados", label: "Atrasados", tono: "text-destructive" },
    { id: "urgentes", label: "Urgentes", tono: "text-destructive" },
    { id: "cerrado", label: "Cerrados", tono: "text-secondary" },
    { id: "anulado", label: "Anulados", tono: "text-secondary" },
  ];

  return (
    <div className="space-y-4">
      {/* Resumen por estado: cada tarjeta filtra la lista. */}
      <div
        role="tablist"
        aria-label="Filtrar por estado"
        className="flex gap-2 overflow-x-auto pb-1"
      >
        {TABS.filter(
          (t) =>
            conteo[t.id] > 0 ||
            t.id === vista ||
            ["todos", "pendiente", "parcial", "completo"].includes(t.id)
        ).map((t) => {
          const activo = vista === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activo}
              onClick={() => {
                setVista(t.id);
                setVisibles(POR_PAGINA);
              }}
              className={`min-w-[104px] shrink-0 rounded-xl border px-4 py-2.5 text-left shadow-sm transition-colors ${
                activo
                  ? "border-brand bg-brand/15 ring-1 ring-brand"
                  : "border-border bg-card hover:bg-muted"
              }`}
            >
              <span
                className={`block text-2xl font-extrabold leading-none ${t.tono || "text-primary"}`}
              >
                {conteo[t.id]}
              </span>
              <span className="mt-1 block text-xs font-semibold text-muted-foreground">
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
          <label className="sm:col-span-2 lg:col-span-4">
            <span className={labelClass}>Buscar</span>
            <input
              type="search"
              className={fieldClass}
              placeholder="Folio, solicitante, artículo, centro…"
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
                setVisibles(POR_PAGINA);
              }}
            />
          </label>
          <label className="lg:col-span-2">
            <span className={labelClass}>Solicitante</span>
            <select
              className={fieldClass}
              value={fSolicitante}
              onChange={(e) => setFSolicitante(e.target.value)}
            >
              <option value="">Todos</option>
              {opciones.solicitantes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="lg:col-span-3">
            <span className={labelClass}>Centro de negocio</span>
            <select
              className={fieldClass}
              value={fCentro}
              onChange={(e) => setFCentro(e.target.value)}
            >
              <option value="">Todos</option>
              {opciones.centros.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="lg:col-span-3">
            <span className={labelClass}>Ordenar por</span>
            <select
              className={fieldClass}
              value={orden}
              onChange={(e) => setOrden(e.target.value as Orden)}
            >
              <option value="recientes">Más recientes</option>
              <option value="antiguos">Más antiguos</option>
              <option value="entrega">Entrega solicitada más próxima</option>
              <option value="urgentes">Urgentes primero</option>
            </select>
          </label>
          <label className="lg:col-span-2">
            <span className={labelClass}>Pedido desde</span>
            <input
              type="date"
              className={fieldClass}
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </label>
          <label className="lg:col-span-2">
            <span className={labelClass}>Pedido hasta</span>
            <input
              type="date"
              className={fieldClass}
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-8 lg:justify-end">
            {hayFiltros && (
              <button
                type="button"
                onClick={limpiar}
                className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-semibold text-accent hover:underline"
              >
                Limpiar filtros
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                setAbiertos(
                  todosAbiertos
                    ? new Set()
                    : new Set(mostrados.map((p) => p.pedidoId))
                )
              }
              disabled={mostrados.length === 0}
              className="inline-flex h-10 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted disabled:opacity-50"
            >
              {todosAbiertos ? "Contraer todos" : "Expandir todos"}
            </button>
            <button
              type="button"
              onClick={actualizar}
              disabled={cargando}
              className="inline-flex h-10 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted disabled:opacity-50"
            >
              {cargando ? "Actualizando…" : "Actualizar"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      {cargando && pedidos.length === 0 && (
        <p className="text-sm text-muted-foreground">Cargando pedidos…</p>
      )}
      {!cargando && !error && (
        <p className="text-sm text-muted-foreground">
          {lista.length === pedidos.length
            ? `${lista.length} pedido${lista.length === 1 ? "" : "s"}`
            : `${lista.length} de ${pedidos.length} pedidos`}
        </p>
      )}
      {!cargando && !error && lista.length === 0 && (
        <p className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {pedidos.length === 0
            ? "Aún no hay pedidos registrados para tu área."
            : "Ningún pedido coincide con los filtros."}
        </p>
      )}

      <ul className="space-y-2">
        {mostrados.map((p) => {
          const estado = ESTADOS[estadoDe(p)];
          const abierto = abiertos.has(p.pedidoId);
          const recibidos = p.items.filter(
            (it) => estadoLinea(it) === "completo"
          ).length;
          const pct = p.items.length
            ? Math.round((recibidos / p.items.length) * 100)
            : 0;
          const tarde = estaAtrasado(p, hoy);
          return (
            <li
              key={p.pedidoId}
              className={`rounded-xl border bg-card shadow-sm ${
                tarde ? "border-destructive/40" : "border-border"
              }`}
            >
              <button
                type="button"
                aria-expanded={abierto}
                onClick={() => alternar(p.pedidoId)}
                className="grid w-full grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 px-4 py-3 text-left lg:grid-cols-[120px_150px_minmax(0,1.4fr)_minmax(0,1fr)_130px_150px]"
              >
                <span className="text-sm font-extrabold text-primary">
                  {p.pedidoId}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${estado.chip}`}
                  >
                    {estado.label}
                  </span>
                  {p.urgente && (
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                      Urgente
                    </span>
                  )}
                  {tarde && (
                    <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-semibold text-destructive-foreground">
                      Atrasado
                    </span>
                  )}
                </span>
                <span className="col-span-2 min-w-0 truncate text-sm text-card-foreground lg:col-span-1">
                  {p.centroNegocio || p.centroCodigo || "—"}
                </span>
                <span className="col-span-2 min-w-0 truncate text-sm text-muted-foreground lg:col-span-1">
                  {p.solicitante || "—"}
                </span>
                <span className="col-span-2 text-xs text-muted-foreground lg:col-span-1">
                  <span className="block">Pedido {formatFecha(p.fecha)}</span>
                  <span
                    className={tarde ? "font-semibold text-destructive" : ""}
                  >
                    Entrega {formatFecha(p.fechaEntrega)}
                  </span>
                </span>
                <span className="col-span-2 lg:col-span-1">
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-success"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    {recibidos}/{p.items.length} art.
                  </span>
                </span>
              </button>

              {abierto && (
                <div className="border-t border-border px-4 py-3">
                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Dato label="Solicitante">{p.solicitante || "—"}</Dato>
                    <Dato label="Despacho">{p.despacho || "—"}</Dato>
                    <Dato label="Entrega solicitada">
                      {formatFecha(p.fechaEntrega)}
                    </Dato>
                    <Dato label="Comentario">{p.comentario || "—"}</Dato>
                    {p.motivoEstado && (
                      <Dato label="Motivo del estado">{p.motivoEstado}</Dato>
                    )}
                  </dl>

                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => repetir(p)}
                      className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted"
                    >
                      Repetir pedido
                    </button>
                    <span className="ml-2 text-xs text-muted-foreground">
                      Copia este pedido en Enviar Pedido para ajustarlo y enviarlo.
                    </span>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead>
                        <tr className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          <th className="py-1.5 pr-3">Artículo</th>
                          <th className="px-3 py-1.5">Pedido</th>
                          <th className="px-3 py-1.5">Recibido</th>
                          <th className="px-3 py-1.5">Estado</th>
                          <th className="px-3 py-1.5">Recibido por</th>
                          <th className="px-3 py-1.5">Recepción bodega</th>
                          <th className="py-1.5 pl-3">Entrega</th>
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
                              <td className="px-3 py-2">
                                {it.recepcionadoPor || "—"}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2">
                                {formatFecha(it.fechaRecepcionBodega)}
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
              )}
            </li>
          );
        })}
      </ul>

      {lista.length > visibles && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setVisibles((v) => v + POR_PAGINA)}
            className="inline-flex h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted"
          >
            Ver más ({lista.length - visibles} restantes)
          </button>
        </div>
      )}
    </div>
  );
}
