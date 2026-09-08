"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

type CentroNegocio = {
  codigo: string;
  descripcion: string;
};

type LineaPedido = {
  id: string;
  categoria: string;
  codigo: string;
  nombre: string;
  unidad: string;
  cantidad: number;
};

let lineaSeq = 0;
function nuevaLineaId() {
  lineaSeq += 1;
  return `linea-${Date.now()}-${lineaSeq}`;
}

/** "2026-09-22" -> "22-09-26". Devuelve el valor original si no calza. */
function formatFecha(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso.trim();
  return `${m[3]}-${m[2]}-${m[1].slice(2)}`;
}

const fieldClass =
  "h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-card-foreground shadow-sm outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const labelClass =
  "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

// Siempre van en copia; el área destino se agrega como tercer destinatario.
const DESTINATARIOS_FIJOS = [
  "adquisiciones@nebchile.cl",
  "gerencia@nebchile.cl",
];
const AREAS = [
  { label: "Refacciones", email: "refacciones@nebchile.cl" },
  { label: "Servicio Técnico", email: "serviciotecnico@nebchile.cl" },
  { label: "Instalaciones", email: "instalaciones@nebchile.cl" },
];

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

function IconChevron() {
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
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * Combobox con búsqueda por texto para elegir el centro de negocio.
 * Muestra solo la descripción; el valor seleccionado es el código.
 */
function CentroCombobox({
  centros,
  value,
  onChange,
}: {
  centros: CentroNegocio[];
  value: string;
  onChange: (codigo: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = "centro-listbox";

  const selected = useMemo(
    () => centros.find((c) => c.codigo === value) ?? null,
    [centros, value]
  );

  const filtradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return centros;
    return centros.filter((c) => c.descripcion.toLowerCase().includes(q));
  }, [centros, query]);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function seleccionar(c: CentroNegocio) {
    onChange(c.codigo);
    setQuery("");
    setOpen(false);
  }

  const displayValue = open ? query : selected?.descripcion ?? "";

  return (
    <div ref={rootRef} className="relative">
      <input
        id="centro"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        className={`${fieldClass} pr-9`}
        placeholder="Escribe para buscar…"
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(0);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            setActiveIndex((i) => Math.min(i + 1, filtradas.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            if (open) {
              e.preventDefault();
              const c = filtradas[activeIndex];
              if (c) seleccionar(c);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      >
        <IconChevron />
      </span>
      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-card py-1 text-sm shadow-lg"
        >
          {filtradas.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">Sin resultados</li>
          ) : (
            filtradas.map((c, i) => (
              <li
                key={c.codigo}
                role="option"
                aria-selected={c.codigo === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  seleccionar(c);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`cursor-pointer px-3 py-2 text-card-foreground ${
                  i === activeIndex ? "bg-accent/10" : ""
                } ${c.codigo === value ? "font-semibold" : ""}`}
              >
                {c.descripcion}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
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

function IconMinus() {
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
      <path d="M5 12h14" />
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
  const [centros, setCentros] = useState<CentroNegocio[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [solicitante, setSolicitante] = useState("");
  const [centroSel, setCentroSel] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [planCuenta, setPlanCuenta] = useState("Insumos");
  const [clasificador1, setClasificador1] = useState("");
  const [clasificador2, setClasificador2] = useState("");
  const [despacho, setDespacho] = useState("");
  const [fechaEntrega, setFechaEntrega] = useState("");
  const [areaDestino, setAreaDestino] = useState("refacciones@nebchile.cl");
  const [comentario, setComentario] = useState("");

  const [lineas, setLineas] = useState<LineaPedido[]>([]);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const [rArt, rCen] = await Promise.all([
          fetch("/api/articulos"),
          fetch("/api/centros"),
        ]);
        const dArt = await rArt.json();
        const dCen = await rCen.json();
        if (!rArt.ok) throw new Error(dArt.error || "Error al cargar artículos");
        if (!rCen.ok)
          throw new Error(dCen.error || "Error al cargar centros de negocio");
        if (!cancelado) {
          setCategorias(dArt.categorias ?? []);
          setCentros(dCen.centros ?? []);
        }
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

  const articulosPorCategoria = useMemo(() => {
    const m = new Map<string, Articulo[]>();
    for (const c of categorias) m.set(c.categoria, c.articulos);
    return m;
  }, [categorias]);

  const centroActual = useMemo(
    () => centros.find((c) => c.codigo === centroSel) ?? null,
    [centros, centroSel]
  );

  const totalUnidades = useMemo(
    () => lineas.reduce((sum, l) => sum + l.cantidad, 0),
    [lineas]
  );

  function agregarLinea() {
    setLineas((prev) => [
      ...prev,
      {
        id: nuevaLineaId(),
        categoria: "",
        codigo: "",
        nombre: "",
        unidad: "",
        cantidad: 1,
      },
    ]);
    setCopiado(false);
  }

  function cambiarCategoriaLinea(id: string, categoria: string) {
    setLineas((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, categoria, codigo: "", nombre: "", unidad: "" }
          : l
      )
    );
    setCopiado(false);
  }

  function cambiarArticuloLinea(id: string, codigo: string) {
    setLineas((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const art = (articulosPorCategoria.get(l.categoria) ?? []).find(
          (a) => a.codigo === codigo
        );
        return {
          ...l,
          codigo,
          nombre: art?.nombre ?? "",
          unidad: art?.unidad ?? "",
        };
      })
    );
    setCopiado(false);
  }

  function cambiarCantidad(id: string, valor: number) {
    if (Number.isNaN(valor)) return;
    const v = valor < 0 ? 0 : valor;
    setLineas((prev) =>
      prev.map((l) => (l.id === id ? { ...l, cantidad: v } : l))
    );
    setCopiado(false);
  }

  function quitarLinea(id: string) {
    setLineas((prev) => prev.filter((l) => l.id !== id));
    setCopiado(false);
  }

  const lineasCompletas = useMemo(
    () => lineas.filter((l) => l.codigo && l.cantidad > 0),
    [lineas]
  );

  const centroDesc = centroActual?.descripcion ?? "";

  const faltante =
    solicitante.trim().length === 0
      ? "Ingresa el solicitante."
      : !centroSel
        ? "Selecciona un centro de negocio."
        : planCuenta.trim().length === 0
          ? "Indica el plan de cuenta."
          : lineasCompletas.length === 0
            ? "Agrega al menos un artículo con cantidad."
            : null;

  const puedeEnviar = !faltante;

  const asunto = `NEB Chile // Adquisiciones // ${centroDesc} // ${planCuenta.trim()}`;

  const cuerpoCorreo = useMemo(() => {
    const h = new Date().getHours();
    const saludo =
      h < 12
        ? "Buenos días, estimados"
        : h < 20
          ? "Buenas tardes, estimados"
          : "Buenas noches, estimados";

    const elementos = lineasCompletas
      .map((l) => `- ${l.cantidad.toLocaleString("es-CL")} ${l.nombre}`)
      .join("\n");

    const partes = [
      asunto,
      "",
      saludo,
      "",
      "Junto con saludar, solicito gestión del siguiente pedido:",
      "",
      `Proveedor: ${proveedor}`.trimEnd(),
      `Centro de Costo: ${centroDesc}`.trimEnd(),
      `Plan de cuenta: ${planCuenta.trim()}`.trimEnd(),
      `Clasificador 1: ${clasificador1}`.trimEnd(),
      `Clasificador 2: ${clasificador2}`.trimEnd(),
      `Despacho: ${despacho}`.trimEnd(),
      `Fecha de entrega: ${formatFecha(fechaEntrega)}`.trimEnd(),
      "",
      "Elementos a solicitar:",
      elementos,
    ];

    if (comentario.trim()) {
      partes.push("", `Comentario: ${comentario.trim()}`);
    }

    partes.push("", "Saludos,", solicitante.trim() || "Nombre");

    return partes.join("\n");
  }, [
    asunto,
    centroDesc,
    clasificador1,
    clasificador2,
    comentario,
    despacho,
    fechaEntrega,
    lineasCompletas,
    planCuenta,
    proveedor,
    solicitante,
  ]);

  const destinatarios = [...DESTINATARIOS_FIJOS, areaDestino];

  const gmailUrl =
    "https://mail.google.com/mail/?view=cm&fs=1" +
    `&to=${encodeURIComponent(destinatarios.join(","))}` +
    `&su=${encodeURIComponent(asunto)}` +
    `&body=${encodeURIComponent(cuerpoCorreo)}`;

  function abrirGmail() {
    if (!puedeEnviar) return;
    window.open(gmailUrl, "_blank", "noopener,noreferrer");
  }

  async function copiarCorreo() {
    try {
      await navigator.clipboard.writeText(
        `Para: ${destinatarios.join(", ")}\nAsunto: ${asunto}\n\n${cuerpoCorreo}`
      );
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2500);
    } catch {
      setCopiado(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-live="polite">
        <span className="sr-only">Cargando datos…</span>
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
        <p className="font-semibold">No se pudieron cargar los datos.</p>
        <p className="mt-1">{loadError}</p>
        <p className="mt-2 text-warning/90">
          Verifica que las variables de entorno de Google (cuenta de servicio,{" "}
          <code className="rounded bg-warning/10 px-1 py-0.5 font-mono text-xs">
            SHEET_ID
          </code>{" "}
          y{" "}
          <code className="rounded bg-warning/10 px-1 py-0.5 font-mono text-xs">
            CENTROS_SHEET_ID
          </code>
          ) estén configuradas y que ambos spreadsheets estén compartidos con la
          cuenta de servicio.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionCard
        step={1}
        title="Datos del pedido"
        description="Estos datos arman el encabezado del correo de solicitud."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="solicitante" className={labelClass}>
              Solicitante (nombre) <span className="text-destructive">*</span>
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
            <label htmlFor="centro" className={labelClass}>
              Centro de negocio / Centro de Costo{" "}
              <span className="text-destructive">*</span>
            </label>
            <CentroCombobox
              centros={centros}
              value={centroSel}
              onChange={setCentroSel}
            />
          </div>
          <div>
            <label htmlFor="planCuenta" className={labelClass}>
              Plan de cuenta <span className="text-destructive">*</span>
            </label>
            <input
              id="planCuenta"
              className={fieldClass}
              value={planCuenta}
              onChange={(e) => setPlanCuenta(e.target.value)}
              placeholder="Ej. Insumos"
            />
          </div>
          <div>
            <label htmlFor="area" className={labelClass}>
              Área destino <span className="text-destructive">*</span>
            </label>
            <select
              id="area"
              className={fieldClass}
              value={areaDestino}
              onChange={(e) => setAreaDestino(e.target.value)}
            >
              {AREAS.map((a) => (
                <option key={a.email} value={a.email}>
                  {a.label} — {a.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="proveedor" className={labelClass}>
              Proveedor
            </label>
            <input
              id="proveedor"
              className={fieldClass}
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <div>
            <label htmlFor="fechaEntrega" className={labelClass}>
              Fecha de entrega
            </label>
            <input
              id="fechaEntrega"
              type="date"
              className={fieldClass}
              value={fechaEntrega}
              onChange={(e) => setFechaEntrega(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="clasificador1" className={labelClass}>
              Clasificador 1
            </label>
            <input
              id="clasificador1"
              className={fieldClass}
              value={clasificador1}
              onChange={(e) => setClasificador1(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <div>
            <label htmlFor="clasificador2" className={labelClass}>
              Clasificador 2
            </label>
            <input
              id="clasificador2"
              className={fieldClass}
              value={clasificador2}
              onChange={(e) => setClasificador2(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <div>
            <label htmlFor="despacho" className={labelClass}>
              Despacho
            </label>
            <input
              id="despacho"
              className={fieldClass}
              value={despacho}
              onChange={(e) => setDespacho(e.target.value)}
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
        title="Artículos del pedido"
        description="Agrega una fila por artículo. Puedes cambiar la categoría, el artículo y la cantidad de cada fila mientras armas el pedido."
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
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
            Aún no has agregado artículos. Usa «Agregar artículo» para empezar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold">Categoría</th>
                  <th className="py-2 pr-3 font-semibold">Artículo</th>
                  <th className="py-2 pr-3 font-semibold">Cantidad</th>
                  <th className="py-2 font-semibold">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  const artsLinea =
                    articulosPorCategoria.get(l.categoria) ?? [];
                  return (
                    <tr
                      key={l.id}
                      className="border-b border-border/70 align-top last:border-0"
                    >
                      <td className="py-2.5 pr-3">
                        <select
                          className={`${fieldClass} min-w-[11rem]`}
                          value={l.categoria}
                          onChange={(e) =>
                            cambiarCategoriaLinea(l.id, e.target.value)
                          }
                          aria-label="Categoría del artículo"
                        >
                          <option value="">Selecciona…</option>
                          {categorias.map((c) => (
                            <option key={c.categoria} value={c.categoria}>
                              {c.categoria} ({c.articulos.length})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 pr-3">
                        <select
                          className={`${fieldClass} min-w-[16rem]`}
                          value={l.codigo}
                          onChange={(e) =>
                            cambiarArticuloLinea(l.id, e.target.value)
                          }
                          disabled={!l.categoria}
                          aria-label="Artículo"
                        >
                          <option value="">
                            {l.categoria
                              ? "Selecciona…"
                              : "Elige categoría primero"}
                          </option>
                          {artsLinea.map((a) => (
                            <option key={a.codigo} value={a.codigo}>
                              {a.nombre} — {a.codigo}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              cambiarCantidad(l.id, l.cantidad - 1)
                            }
                            disabled={l.cantidad <= 1}
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label="Disminuir cantidad"
                          >
                            <IconMinus />
                          </button>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            inputMode="decimal"
                            value={l.cantidad || ""}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const n = raw === "" ? 0 : Number(raw);
                              if (!Number.isNaN(n)) cambiarCantidad(l.id, n);
                            }}
                            onBlur={() => {
                              if (!(l.cantidad > 0)) cambiarCantidad(l.id, 1);
                            }}
                            className="h-8 w-16 rounded-md border border-border bg-card px-2 text-center text-sm tabular-nums text-card-foreground outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
                            aria-label="Cantidad"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              cambiarCantidad(l.id, l.cantidad + 1)
                            }
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted"
                            aria-label="Aumentar cantidad"
                          >
                            <IconPlus />
                          </button>
                          <span className="ml-1 text-xs text-muted-foreground">
                            {l.unidad || "—"}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => quitarLinea(l.id)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10"
                          aria-label="Quitar fila"
                        >
                          <IconTrash />
                          Quitar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <button
          type="button"
          onClick={agregarLinea}
          className="mt-4 inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted"
        >
          <IconPlus />
          Agregar artículo
        </button>

        <div className="mt-6 border-t border-border pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={abrirGmail}
              disabled={!puedeEnviar}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-6 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Abrir correo en Gmail
            </button>
            <button
              type="button"
              onClick={copiarCorreo}
              disabled={!puedeEnviar}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copiado ? (
                <>
                  <IconCheck />
                  Copiado
                </>
              ) : (
                "Copiar correo"
              )}
            </button>
            {faltante && (
              <span className="text-xs text-muted-foreground">{faltante}</span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Se abre Gmail con el correo listo para {destinatarios.join(", ")}.
            Revísalo y presiona Enviar. No se escribe nada en la planilla.
          </p>

          {puedeEnviar && (
            <details className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <summary className="cursor-pointer font-semibold text-primary">
                Vista previa del correo
              </summary>
              <p className="mt-2 text-xs font-semibold text-muted-foreground">
                Asunto: <span className="font-normal">{asunto}</span>
              </p>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-card-foreground">
                {cuerpoCorreo}
              </pre>
            </details>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
