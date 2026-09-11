"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

/** Suma días hábiles (lunes a viernes) a una fecha. No considera feriados. */
function sumarDiasHabiles(desde: Date, dias: number): Date {
  const d = new Date(desde);
  let sumados = 0;
  while (sumados < dias) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) sumados += 1;
  }
  return d;
}

/** Date -> "YYYY-MM-DD" en horario local (para <input type="date">). */
function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Fecha de entrega por defecto: 10 días hábiles desde hoy. */
function fechaEntregaPorDefecto(): string {
  return toInputDate(sumarDiasHabiles(new Date(), 10));
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
// Cada área destino filtra los centros de negocio por el prefijo de su código
// (columna C de la planilla de centros): RCT = Refacciones, SST = Servicio
// Técnico, INT = Instalaciones.
const AREAS = [
  { label: "Refacciones", email: "refacciones@nebchile.cl", prefijo: "RCT" },
  { label: "Servicio Técnico", email: "serviciotecnico@nebchile.cl", prefijo: "SST" },
  { label: "Instalaciones", email: "instalaciones@nebchile.cl", prefijo: "INT" },
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

type ComboOption = { value: string; label: string };

/**
 * Combobox con búsqueda por texto: escribe para filtrar por `label` y elige
 * una opción; `onChange` recibe su `value`. La lista se renderiza en un
 * portal (posición fija calculada desde el input) para que no se corte
 * dentro de contenedores con scroll, como la tabla de artículos.
 */
function SearchCombobox({
  id,
  ariaLabel,
  options,
  value,
  onChange,
  placeholder = "Escribe para buscar…",
  disabled,
  inputClassName = "",
}: {
  id?: string;
  ariaLabel?: string;
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  inputClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(
    null
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  const filtradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  function actualizarRect() {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom, left: r.left, width: r.width });
  }

  useEffect(() => {
    if (!open) return;
    actualizarRect();
    window.addEventListener("scroll", actualizarRect, true);
    window.addEventListener("resize", actualizarRect);
    return () => {
      window.removeEventListener("scroll", actualizarRect, true);
      window.removeEventListener("resize", actualizarRect);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function seleccionar(o: ComboOption) {
    onChange(o.value);
    setQuery("");
    setOpen(false);
  }

  const displayValue = open ? query : selected?.label ?? "";

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        className={`${fieldClass} pr-9 ${inputClassName}`}
        placeholder={placeholder}
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
              const o = filtradas[activeIndex];
              if (o) seleccionar(o);
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
      {open &&
        rect &&
        createPortal(
          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            style={{
              position: "fixed",
              top: rect.top + 4,
              left: rect.left,
              width: rect.width,
            }}
            className="z-50 max-h-64 overflow-auto rounded-lg border border-border bg-card py-1 text-sm shadow-lg"
          >
            {filtradas.length === 0 ? (
              <li className="px-3 py-2 text-muted-foreground">Sin resultados</li>
            ) : (
              filtradas.map((o, i) => (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    seleccionar(o);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`cursor-pointer px-3 py-2 text-card-foreground ${
                    i === activeIndex ? "bg-accent/10" : ""
                  } ${o.value === value ? "font-semibold" : ""}`}
                >
                  {o.label}
                </li>
              ))
            )}
          </ul>,
          document.body
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
  const [areaDestino, setAreaDestino] = useState(AREAS[0].email);
  const [centroSel, setCentroSel] = useState("");
  const [clasificador1, setClasificador1] = useState("");
  const [clasificador2, setClasificador2] = useState("");
  const [despacho, setDespacho] = useState("");
  const [fechaEntrega, setFechaEntrega] = useState(fechaEntregaPorDefecto);
  const [comentario, setComentario] = useState("");

  const [lineas, setLineas] = useState<LineaPedido[]>([]);
  const [copiado, setCopiado] = useState(false);
  const [registrando, setRegistrando] = useState(false);
  const [registro, setRegistro] = useState<
    { ok: true; folio: string } | { ok: false; error: string } | null
  >(null);

  const areaActual = useMemo(
    () => AREAS.find((a) => a.email === areaDestino) ?? AREAS[0],
    [areaDestino]
  );

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

  // Lista plana de todos los artículos, para buscar directamente por nombre
  // sin tener que elegir antes una categoría.
  const todosLosArticulos = useMemo(
    () => categorias.flatMap((c) => c.articulos),
    [categorias]
  );

  // Solo los centros cuyo código empieza con el prefijo del área elegida.
  const centrosDelArea = useMemo(
    () =>
      centros.filter((c) =>
        c.codigo.toUpperCase().startsWith(areaActual.prefijo)
      ),
    [centros, areaActual]
  );

  const centroActual = useMemo(
    () => centros.find((c) => c.codigo === centroSel) ?? null,
    [centros, centroSel]
  );

  function cambiarArea(email: string) {
    setAreaDestino(email);
    // El centro elegido puede no pertenecer a la nueva área: se limpia siempre.
    setCentroSel("");
    setCopiado(false);
    setRegistro(null);
  }

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
        // Se busca en todos los artículos (no solo los de la categoría ya
        // elegida) para poder escribir el nombre del artículo directamente;
        // la categoría de la fila se actualiza a la que realmente le
        // corresponde.
        const art = todosLosArticulos.find((a) => a.codigo === codigo);
        if (!art) return { ...l, codigo, nombre: "", unidad: "" };
        return {
          ...l,
          categoria: art.categoria,
          codigo: art.codigo,
          nombre: art.nombre,
          unidad: art.unidad,
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
        : lineasCompletas.length === 0
          ? "Agrega al menos un artículo con cantidad."
          : null;

  const puedeEnviar = !faltante;

  const asunto = `NEB Chile // Adquisiciones // ${areaActual.label} // ${centroDesc}`;

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
      saludo,
      "",
      "Junto con saludar, solicito gestión del siguiente pedido:",
      "",
      `Área: ${areaActual.label}`.trimEnd(),
      `Centro de Costo: ${centroDesc}`.trimEnd(),
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
    areaActual,
    centroDesc,
    clasificador1,
    clasificador2,
    comentario,
    despacho,
    fechaEntrega,
    lineasCompletas,
    solicitante,
  ]);

  const destinatarios = [...DESTINATARIOS_FIJOS, areaDestino];

  const gmailUrl =
    "https://mail.google.com/mail/?view=cm&fs=1" +
    `&to=${encodeURIComponent(destinatarios.join(","))}` +
    `&su=${encodeURIComponent(asunto)}` +
    `&body=${encodeURIComponent(cuerpoCorreo)}`;

  function abrirGmail() {
    window.open(gmailUrl, "_blank", "noopener,noreferrer");
  }

  async function registrarPedido(): Promise<
    { ok: true; folio: string } | { ok: false; error: string }
  > {
    try {
      const res = await fetch("/api/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          solicitante: solicitante.trim(),
          area: { label: areaActual.label, email: areaActual.email },
          centroNegocio: centroActual
            ? { codigo: centroActual.codigo, descripcion: centroActual.descripcion }
            : null,
          fechaEntrega: formatFecha(fechaEntrega),
          clasificador1: clasificador1.trim(),
          clasificador2: clasificador2.trim(),
          despacho: despacho.trim(),
          comentario: comentario.trim(),
          items: lineasCompletas.map((l) => ({
            codigo: l.codigo,
            nombre: l.nombre,
            categoria: l.categoria,
            unidad: l.unidad,
            cantidad: l.cantidad,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || "No se pudo registrar el pedido." };
      }
      return { ok: true, folio: data.pedidoId as string };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Error de red al registrar.",
      };
    }
  }

  async function registrarYAbrir() {
    if (!puedeEnviar || registrando) return;
    setRegistrando(true);
    setRegistro(null);
    const resultado = await registrarPedido();
    setRegistro(resultado);
    setRegistrando(false);
    // Se abre Gmail igual: el registro en planilla es complementario al correo.
    abrirGmail();
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
            <label htmlFor="area" className={labelClass}>
              Área destino <span className="text-destructive">*</span>
            </label>
            <select
              id="area"
              className={fieldClass}
              value={areaDestino}
              onChange={(e) => cambiarArea(e.target.value)}
            >
              {AREAS.map((a) => (
                <option key={a.email} value={a.email}>
                  {a.label} — {a.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="centro" className={labelClass}>
              Centro de negocio / Centro de Costo{" "}
              <span className="text-destructive">*</span>
            </label>
            <SearchCombobox
              key={areaActual.prefijo}
              id="centro"
              ariaLabel="Centro de negocio"
              options={centrosDelArea.map((c) => ({
                value: c.codigo,
                label: c.descripcion,
              }))}
              value={centroSel}
              onChange={setCentroSel}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Solo centros de {areaActual.label} ({centrosDelArea.length}
              {" "}disponibles).
            </p>
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
            <p className="mt-1 text-xs text-muted-foreground">
              Por defecto, 10 días hábiles desde hoy.
            </p>
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
        description="Agrega una fila por artículo. Escribe para buscar directamente el artículo (no hace falta elegir antes la categoría) o filtra primero por categoría."
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
                  // Sin categoría elegida, se busca entre todos los
                  // artículos; con categoría, se acota a esa categoría.
                  const artsLinea = l.categoria
                    ? articulosPorCategoria.get(l.categoria) ?? []
                    : todosLosArticulos;
                  return (
                    <tr
                      key={l.id}
                      className="border-b border-border/70 align-top last:border-0"
                    >
                      <td className="py-2.5 pr-3">
                        <SearchCombobox
                          inputClassName="min-w-[11rem]"
                          ariaLabel="Categoría del artículo"
                          placeholder="Buscar categoría…"
                          options={categorias.map((c) => ({
                            value: c.categoria,
                            label: `${c.categoria} (${c.articulos.length})`,
                          }))}
                          value={l.categoria}
                          onChange={(categoria) =>
                            cambiarCategoriaLinea(l.id, categoria)
                          }
                        />
                      </td>
                      <td className="py-2.5 pr-3">
                        <SearchCombobox
                          inputClassName="min-w-[16rem]"
                          ariaLabel="Artículo"
                          placeholder={
                            l.categoria
                              ? "Buscar artículo…"
                              : "Buscar en todos los artículos…"
                          }
                          options={artsLinea.map((a) => ({
                            value: a.codigo,
                            label: `${a.nombre} — ${a.codigo}`,
                          }))}
                          value={l.codigo}
                          onChange={(codigo) =>
                            cambiarArticuloLinea(l.id, codigo)
                          }
                        />
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
              onClick={registrarYAbrir}
              disabled={!puedeEnviar || registrando}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-6 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {registrando ? "Registrando…" : "Registrar y abrir correo en Gmail"}
            </button>
            <button
              type="button"
              onClick={abrirGmail}
              disabled={!puedeEnviar}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              Solo abrir Gmail
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
            «Registrar y abrir correo» guarda una fila por artículo en la pestaña{" "}
            <span className="font-semibold">Pedidos</span> de la planilla y abre
            Gmail con el correo listo para {destinatarios.join(", ")}. Revísalo y
            presiona Enviar.
          </p>

          {registro && (
            <p
              className={`mt-2 text-xs font-semibold ${
                registro.ok ? "text-success" : "text-warning"
              }`}
              role="status"
            >
              {registro.ok
                ? `Pedido registrado en la planilla con folio ${registro.folio}.`
                : `No se pudo registrar en la planilla: ${registro.error} (el correo se abrió igual).`}
            </p>
          )}

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
