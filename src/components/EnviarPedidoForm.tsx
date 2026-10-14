"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import SearchCombobox from "./SearchCombobox";

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
  // Artículo escrito a mano porque no está en el catálogo de Defontana.
  manual: boolean;
  // Detalle específico de este artículo (p. ej. color, medida, repuesto para
  // qué equipo). Se agrega al correo junto a la línea del artículo.
  comentario: string;
};

// Código con el que se guardan los artículos manuales en la planilla: no
// corresponde a un código real de Defontana, así que Adquisiciones lo ve
// como señal de que hay que revisar el nombre escrito a mano.
const CODIGO_MANUAL = "MANUAL";

let lineaSeq = 0;
function nuevaLineaId() {
  lineaSeq += 1;
  return `linea-${Date.now()}-${lineaSeq}`;
}

/** Normaliza para comparar categorías sin importar tildes/mayúsculas. */
function normalizarCategoria(v: string): string {
  return v
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
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
  "h-11 w-full rounded-lg border border-border bg-card px-3 text-base sm:text-sm text-card-foreground shadow-sm outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const labelClass =
  "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground";
// Como fieldClass, pero sin w-full: se usa en inputs dentro de un flex row
// (nombre + unidad del artículo manual) donde el ancho lo da flex/w-16.
const manualFieldClass =
  "h-11 md:h-9 rounded-lg border border-border bg-card px-3 text-base sm:text-sm text-card-foreground shadow-sm outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40";

// El correo va directo a Adquisiciones, con copia (CC) al área destino.
const DESTINATARIO_PRINCIPAL = "adquisiciones@nebchile.cl";
// Cada área destino filtra los centros de negocio por el prefijo de su código
// (columna C de la planilla de centros): RCT = Refacciones, SST = Servicio
// Técnico, INT = Instalaciones.
const AREAS = [
  { label: "Refacciones", email: "refacciones@nebchile.cl", prefijo: "RCT" },
  { label: "Servicio Técnico", email: "serviciotecnico@nebchile.cl", prefijo: "SST" },
  { label: "Instalaciones", email: "instalaciones@nebchile.cl", prefijo: "INT" },
];

// Clasificador 1 (AREA_TRAB) y Clasificador 2 (AREA_NEG): "código - descripción".
const CLASIFICADORES_1 = [
  "01 PSM - Mantenimiento",
  "02 PST - Correctivos",
  "03 PSP - Correctivos generados por Área Comercial",
  "04 STT - Generales Servicio Técnico",
  "05 INT - Instalaciones",
  "06 RCT - Refacciones de Central Térmica",
  "07 RBP - Redes de Baja Presión",
  "08 ING - Ingeniería",
  "09 PSEI - Emergencia Dia Inhábil",
  "10 GNR - General Empresa",
  "11 PSE - Emergencia Diurna",
  "12 PSG - Periodo de Garantía",
  "13 CDI - B2C - Campaña de Invierno",
  "14 B2C - B2C - Cambio de medidores",
  "15 TYP - Transición y Postventa",
];
const CLASIFICADORES_2 = [
  "01 SDC - Sala de Calderas",
  "02 SDB - Sala de Bombas",
  "03 VDA - Verticales Dist. Aguas y Calefacción",
  "04 MDA - Manejo de Aire",
  "05 GRE - Grupo Electrógeno",
  "06 PST - Paneles Solares Térmicos",
  "07 OTR - Otros",
  "08 CAL - Calefacción",
  "09 CLI - Climatización",
  "10 GNR - General Empresa",
];
const OPCIONES_DESPACHO = [
  "RETIRA LOGISTICA NEB",
  "RETIRA SOLICITANTE",
  "DESPACHO PROVEEDOR",
  "STOCK EN BODEGA",
];

type Plataforma = "ios" | "android" | null;

type CorreoGmail = {
  para: string;
  cc: string;
  asunto: string;
  cuerpoCorreo: string;
  gmailUrl: string;
};

/** Detecta si se está en un celular/tablet (donde conviene abrir la app de Gmail). */
function detectarPlataforma(): Plataforma {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (
    /iPhone|iPad|iPod/i.test(ua) ||
    // iPadOS se presenta como Mac, pero con pantalla táctil.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  )
    return "ios";
  return null;
}

type ResumenEnvio = {
  solicitante: string;
  area: string;
  centro: string;
  entrega: string;
  despacho: string;
  clasificador1: string;
  clasificador2: string;
  para: string;
  cc: string;
  urgente: boolean;
  items: {
    id: string;
    nombre: string;
    cantidad: number;
    unidad: string;
    comentario: string;
  }[];
  unidades: number;
};

/**
 * Confirmación antes de registrar y abrir el correo. Se monta solo mientras
 * está abierta. El foco parte en «No, volver a editar» (la opción segura).
 */
function ConfirmarEnvioDialog({
  resumen,
  enviando,
  onCancelar,
  onConfirmar,
}: {
  resumen: ResumenEnvio;
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const volverRef = useRef<HTMLButtonElement>(null);
  const propsRef = useRef({ enviando, onCancelar });
  useEffect(() => {
    propsRef.current = { enviando, onCancelar };
  });

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    volverRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (!propsRef.current.enviando) propsRef.current.onCancelar();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled])"
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previo?.focus();
    };
  }, []);

  const datos: [string, string][] = [
    ["Solicitante", resumen.solicitante],
    ["Área", resumen.area],
    ["Centro de negocio", resumen.centro],
    ["Fecha de entrega", resumen.entrega],
  ];
  if (resumen.despacho) datos.push(["Despacho", resumen.despacho]);
  if (resumen.clasificador1) datos.push(["Clasificador 1", resumen.clasificador1]);
  if (resumen.clasificador2) datos.push(["Clasificador 2", resumen.clasificador2]);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-primary/55 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCancelar();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmar-titulo"
        aria-describedby="confirmar-desc"
        className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-start gap-3 px-5 pb-3 pt-5">
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-brand-foreground"
          >
            <IconWarning />
          </span>
          <div>
            <h2
              id="confirmar-titulo"
              className="text-lg font-extrabold leading-snug tracking-tight text-primary"
            >
              ¿Estás realmente seguro de que tu pedido está correcto?
            </h2>
            <p
              id="confirmar-desc"
              className="mt-1 text-sm text-muted-foreground"
            >
              Al confirmar se registra en la planilla y se abre el correo listo
              para enviar. No podrás editarlo: tendrás que enviarlo sí o sí.
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {resumen.urgente && (
            <p className="mb-3 rounded-lg bg-warning-surface px-3 py-2 text-sm font-bold text-warning">
              Este pedido se enviará como URGENTE.
            </p>
          )}
          <dl className="grid gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm sm:grid-cols-2">
            {datos.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {k}
                </dt>
                <dd className="break-words font-medium text-card-foreground">
                  {v || "—"}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {resumen.items.length}{" "}
            {resumen.items.length === 1 ? "artículo" : "artículos"} ·{" "}
            {resumen.unidades.toLocaleString("es-CL")} unidades
          </p>
          <ul className="divide-y divide-border/70 rounded-lg border border-border text-sm">
            {resumen.items.map((it) => (
              <li key={it.id} className="px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-words text-card-foreground">
                    {it.nombre}
                  </span>
                  <span className="shrink-0 font-bold tabular-nums text-primary">
                    {it.cantidad.toLocaleString("es-CL")}{" "}
                    <span className="font-normal text-muted-foreground">
                      {it.unidad}
                    </span>
                  </span>
                </div>
                {it.comentario && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {it.comentario}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Para: {resumen.para} · CC: {resumen.cc}
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border bg-card px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
          <button
            ref={volverRef}
            type="button"
            onClick={onCancelar}
            disabled={enviando}
            className="inline-flex h-12 items-center justify-center rounded-lg border border-border bg-card px-5 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted disabled:opacity-50 sm:h-11"
          >
            No, volver a editar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={enviando}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-accent px-5 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70 sm:h-11"
          >
            {enviando ? "Registrando…" : "Sí, enviar"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function IconWarning() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

function IconMail() {
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
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

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
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-sm font-extrabold text-brand-foreground"
        >
          {step}
        </span>
        <div>
          <h2 className="text-base font-bold leading-8 text-primary">{title}</h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
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

type EnviarPedidoFormProps = {
  // Si se pasa, solo se muestran (y quedan seleccionables) estas categorías
  // de artículos, comparando sin distinguir mayúsculas/minúsculas.
  categoriasPermitidas?: string[];
};

export default function EnviarPedidoForm({
  categoriasPermitidas,
}: EnviarPedidoFormProps = {}) {
  const [categorias, setCategorias] = useState<CategoriaConArticulos[]>([]);
  const [centros, setCentros] = useState<CentroNegocio[]>([]);
  const [solicitantes, setSolicitantes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [solicitante, setSolicitante] = useState("");
  const [areaDestino, setAreaDestino] = useState(AREAS[0].email);
  const [centroSel, setCentroSel] = useState("");
  const [clasificador1, setClasificador1] = useState("");
  const [clasificador2, setClasificador2] = useState("");
  const [despacho, setDespacho] = useState("");
  const [fechaEntrega, setFechaEntrega] = useState(fechaEntregaPorDefecto);
  const [urgente, setUrgente] = useState(false);
  const [comentario, setComentario] = useState("");

  const [lineas, setLineas] = useState<LineaPedido[]>([]);
  const [registrando, setRegistrando] = useState(false);
  const [registro, setRegistro] = useState<
    { ok: true; folio: string } | { ok: false; error: string } | null
  >(null);
  const [correoRegistrado, setCorreoRegistrado] = useState<CorreoGmail | null>(
    null
  );
  const [confirmando, setConfirmando] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

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
          const todas: CategoriaConArticulos[] = dArt.categorias ?? [];
          const permitidasNorm = categoriasPermitidas?.map(normalizarCategoria);
          const filtradas = permitidasNorm
            ? todas.filter((c) =>
                permitidasNorm.includes(normalizarCategoria(c.categoria))
              )
            : todas;
          setCategorias(filtradas);
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
    // categoriasPermitidas es una constante fija por página (no cambia en
    // la vida del componente), así que se omite a propósito para no volver
    // a pedir /api/articulos en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Las sugerencias de solicitante son opcionales: si fallan, el campo sigue
  // funcionando como texto libre.
  useEffect(() => {
    let cancelado = false;
    fetch("/api/solicitantes")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelado && d?.solicitantes) setSolicitantes(d.solicitantes);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, []);

  const opcionesSolicitante = useMemo(
    () => solicitantes.map((n) => ({ value: n, label: n })),
    [solicitantes]
  );

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
        manual: false,
        comentario: "",
      },
    ]);
  }

  function cambiarCategoriaLinea(id: string, categoria: string) {
    setLineas((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, categoria, codigo: "", nombre: "", unidad: "" }
          : l
      )
    );
  }

  // Quita el filtro de categoría de la fila sin tocar el artículo ya
  // elegido: así no queda "atrapada" buscando solo dentro de esa categoría.
  function limpiarCategoriaLinea(id: string) {
    setLineas((prev) =>
      prev.map((l) => (l.id === id ? { ...l, categoria: "" } : l))
    );
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
  }

  // Artículos que no están en el catálogo de Defontana: se escriben a mano
  // (nombre y unidad libres) en vez de elegirse del combobox.
  function activarArticuloManual(id: string) {
    setLineas((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, manual: true, codigo: CODIGO_MANUAL, nombre: "", unidad: "UN" }
          : l
      )
    );
  }

  function desactivarArticuloManual(id: string) {
    setLineas((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, manual: false, codigo: "", nombre: "", unidad: "" }
          : l
      )
    );
  }

  function cambiarNombreManual(id: string, nombre: string) {
    setLineas((prev) => prev.map((l) => (l.id === id ? { ...l, nombre } : l)));
  }

  function cambiarUnidadManual(id: string, unidad: string) {
    setLineas((prev) => prev.map((l) => (l.id === id ? { ...l, unidad } : l)));
  }

  function cambiarComentarioLinea(id: string, comentario: string) {
    setLineas((prev) =>
      prev.map((l) => (l.id === id ? { ...l, comentario } : l))
    );
  }

  function cambiarCantidad(id: string, valor: number) {
    if (Number.isNaN(valor)) return;
    const v = valor < 0 ? 0 : valor;
    setLineas((prev) =>
      prev.map((l) => (l.id === id ? { ...l, cantidad: v } : l))
    );
  }

  function quitarLinea(id: string) {
    setLineas((prev) => prev.filter((l) => l.id !== id));
  }

  const lineasCompletas = useMemo(
    () =>
      lineas.filter(
        (l) =>
          l.codigo &&
          l.cantidad > 0 &&
          (!l.manual || l.nombre.trim().length > 0)
      ),
    [lineas]
  );

  const centroDesc = centroActual?.descripcion ?? "";

  // Pedido normal: la entrega es desde 10 días hábiles en adelante. Pedido
  // urgente: puede ser cualquier fecha desde hoy.
  const minEntrega = urgente
    ? toInputDate(new Date())
    : fechaEntregaPorDefecto();

  function cambiarUrgente(valor: boolean) {
    setUrgente(valor);
    // Al quitar «urgente», una fecha anterior al mínimo vuelve al mínimo.
    if (!valor && fechaEntrega && fechaEntrega < fechaEntregaPorDefecto()) {
      setFechaEntrega(fechaEntregaPorDefecto());
    }
    // Pedido urgente: siempre lo retira el solicitante (no pasa por
    // logística/proveedor). Al desmarcar «urgente» se limpia para que lo
    // vuelvan a elegir.
    if (valor) {
      setDespacho("RETIRA SOLICITANTE");
    } else {
      setDespacho("");
    }
  }

  // Se corrige al salir del campo (no mientras se escribe, porque el año se
  // teclea de a un dígito y pasaría por fechas intermedias menores al mínimo).
  function corregirFechaEntrega() {
    if (fechaEntrega && fechaEntrega < minEntrega) setFechaEntrega(minEntrega);
  }

  const faltante =
    solicitante.trim().length === 0
      ? "Ingresa el solicitante."
      : !centroSel
        ? "Selecciona un centro de negocio."
        : !clasificador1
          ? "Selecciona el Clasificador 1."
          : !clasificador2
            ? "Selecciona el Clasificador 2."
            : lineasCompletas.length === 0
              ? "Agrega al menos un artículo con cantidad."
              : fechaEntrega && fechaEntrega < minEntrega
                ? `La fecha de entrega debe ser desde el ${formatFecha(minEntrega)} (10 días hábiles). Marca «Pedido urgente» para elegir una anterior.`
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
      .map((l) => {
        const base = `- ${l.cantidad.toLocaleString("es-CL")} ${l.nombre}`;
        return l.comentario.trim()
          ? `${base} (Comentario: ${l.comentario.trim()})`
          : base;
      })
      .join("\n");

    const partes = [
      saludo,
      "",
      "Junto con saludar, solicito gestión del siguiente pedido:",
      ...(urgente ? ["", "*** PEDIDO URGENTE ***"] : []),
      "",
      `Área: ${areaActual.label}`.trimEnd(),
      `Centro de Costo: ${centroDesc}`.trimEnd(),
      `Clasificador 1: ${clasificador1}`.trimEnd(),
      `Clasificador 2: ${clasificador2}`.trimEnd(),
      `Despacho: ${despacho}`.trimEnd(),
      `Fecha de entrega: ${formatFecha(fechaEntrega)}${urgente ? " (PEDIDO URGENTE)" : ""}`.trimEnd(),
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
    urgente,
    lineasCompletas,
    solicitante,
  ]);

  // Directo a Adquisiciones; el área va en copia.
  const para = DESTINATARIO_PRINCIPAL;
  const cc = areaDestino;

  // /a/nebchile.cl/ fuerza la cuenta Workspace de NEB aunque el navegador
  // tenga una cuenta personal como principal (/u/0/).
  const gmailUrl =
    "https://mail.google.com/a/nebchile.cl/mail/?view=cm&fs=1" +
    `&to=${encodeURIComponent(para)}` +
    `&cc=${encodeURIComponent(cc)}` +
    `&su=${encodeURIComponent(asunto)}` +
    `&body=${encodeURIComponent(cuerpoCorreo)}`;

  const correoActual: CorreoGmail = { para, cc, asunto, cuerpoCorreo, gmailUrl };

  /**
   * En PC abre Gmail web en otra pestaña. En celular abre la APP de Gmail con
   * el correo ya redactado (la versión web móvil es incómoda y falla).
   *  - Android: intent hacia com.google.android.gm; si la app no está, cae a
   *    Gmail web.
   *  - iOS: esquema googlegmail://; si la app no se abre, cae a mailto:.
   */
  function abrirGmail(correo: CorreoGmail = correoActual) {
    const { para, cc, asunto, cuerpoCorreo, gmailUrl } = correo;
    const plataforma = detectarPlataforma();
    if (!plataforma) {
      window.open(gmailUrl, "_blank", "noopener,noreferrer");
      return;
    }

    const asuntoEnc = encodeURIComponent(asunto);
    const cuerpoEnc = encodeURIComponent(cuerpoCorreo);

    if (plataforma === "android") {
      window.location.href =
        `intent:${para}?cc=${cc}&subject=${asuntoEnc}&body=${cuerpoEnc}` +
        "#Intent;action=android.intent.action.SENDTO;scheme=mailto;" +
        "package=com.google.android.gm;" +
        `S.browser_fallback_url=${encodeURIComponent(gmailUrl)};end`;
      return;
    }

    // iOS: si tras un momento la página sigue visible, la app no se abrió.
    let salio = false;
    const alOcultar = () => {
      if (document.hidden) salio = true;
    };
    document.addEventListener("visibilitychange", alOcultar);
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", alOcultar);
      if (!salio && !document.hidden) {
        window.location.href = `mailto:${para}?cc=${cc}&subject=${asuntoEnc}&body=${cuerpoEnc}`;
      }
    }, 1600);
    window.location.href =
      `googlegmail:///co?to=${encodeURIComponent(para)}` +
      `&cc=${encodeURIComponent(cc)}` +
      `&subject=${asuntoEnc}&body=${cuerpoEnc}`;
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
          urgente,
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
            comentario: l.comentario.trim(),
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
    setConfirmando(false);
    if (resultado.ok) {
      // Copia del correo para «Abrir Gmail» y limpieza de los campos, así el
      // pedido no se puede volver a registrar por error.
      setCorreoRegistrado(correoActual);
      limpiarCampos();
    }
    // Deja visible el aviso de resultado (con «Abrir Gmail» por si el sistema
    // bloquea la apertura automática) y abre el correo.
    bannerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Se abre Gmail igual: el registro en planilla es complementario al correo.
    abrirGmail(correoActual);
  }

  /** Vacía el pedido; conserva solicitante y área. */
  function limpiarCampos() {
    setLineas([]);
    setCentroSel("");
    setClasificador1("");
    setClasificador2("");
    setDespacho("");
    setComentario("");
    setFechaEntrega(fechaEntregaPorDefecto());
    setUrgente(false);
  }

  function nuevoPedido() {
    setRegistro(null);
    setCorreoRegistrado(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  const unidadesCompletas = lineasCompletas.reduce(
    (sum, l) => sum + l.cantidad,
    0
  );

  const resumenEnvio: ResumenEnvio = {
    solicitante: solicitante.trim(),
    area: areaActual.label,
    centro: centroDesc,
    entrega: `${formatFecha(fechaEntrega)}${urgente ? " · URGENTE" : ""}`,
    despacho,
    clasificador1,
    clasificador2,
    para,
    cc,
    urgente,
    items: lineasCompletas.map((l) => ({
      id: l.id,
      nombre: l.nombre,
      cantidad: l.cantidad,
      unidad: l.unidad,
      comentario: l.comentario.trim(),
    })),
    unidades: unidadesCompletas,
  };

  const COLUMNAS_LINEA =
    "md:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)_11rem_2.5rem]";
  const miniLabel =
    "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:hidden";
  const botonSecundario =
    "inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="grid items-start gap-6 pb-32 xl:grid-cols-[minmax(0,1fr)_400px] xl:pb-0 2xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="min-w-0 space-y-6">
        {registro && (
          <div
            ref={bannerRef}
            role="status"
            className={`scroll-mt-24 rounded-xl border p-4 sm:p-5 ${
              registro.ok
                ? "border-success/30 bg-success-surface"
                : "border-warning/40 bg-warning-surface"
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-accent-foreground ${
                  registro.ok ? "bg-success" : "bg-warning"
                }`}
              >
                {registro.ok ? <IconCheck /> : <IconWarning />}
              </span>
              <div className="min-w-0">
                <p
                  className={`font-bold ${
                    registro.ok ? "text-success" : "text-warning"
                  }`}
                >
                  {registro.ok
                    ? `Pedido registrado · folio ${registro.folio}`
                    : "No se pudo registrar el pedido en la planilla"}
                </p>
                <p className="mt-0.5 text-sm text-card-foreground/80">
                  {registro.ok
                    ? "Si Gmail no se abrió solo, toca «Abrir Gmail». Revisa el correo y presiona Enviar."
                    : `${registro.error} El correo se abrió igual; si no lo ves, toca «Abrir Gmail».`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      abrirGmail(
                        registro.ok && correoRegistrado
                          ? correoRegistrado
                          : correoActual
                      )
                    }
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover"
                  >
                    <IconMail />
                    Abrir Gmail
                  </button>
                  {registro.ok && (
                    <button
                      type="button"
                      onClick={nuevoPedido}
                      className={botonSecundario}
                    >
                      Hacer otro pedido
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <SectionCard
          step={1}
          title="Datos del pedido"
          description="Estos datos arman el encabezado del correo de solicitud."
        >
          <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
            <div>
              <label htmlFor="solicitante" className={labelClass}>
                Solicitante (nombre) <span className="text-destructive">*</span>
              </label>
              <SearchCombobox
                id="solicitante"
                ariaLabel="Solicitante"
                options={opcionesSolicitante}
                value={solicitante}
                onChange={setSolicitante}
                placeholder="Escribe el nombre de quien solicita"
                allowCustom
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="fechaEntrega" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Fecha de entrega
                </label>
                <label
                  className={`-my-1 inline-flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold transition-colors ${
                    urgente
                      ? "bg-warning-surface text-warning"
                      : "text-secondary hover:bg-muted"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-warning"
                    checked={urgente}
                    onChange={(e) => cambiarUrgente(e.target.checked)}
                  />
                  Pedido urgente
                </label>
              </div>
              <input
                id="fechaEntrega"
                type="date"
                className={fieldClass}
                value={fechaEntrega}
                min={minEntrega}
                onChange={(e) => setFechaEntrega(e.target.value)}
                onBlur={corregirFechaEntrega}
              />
              <p
                className={`mt-1 text-xs ${
                  urgente ? "font-medium text-warning" : "text-muted-foreground"
                }`}
              >
                {urgente
                  ? "Pedido urgente: puedes elegir una fecha anterior a 10 días hábiles."
                  : `Mínimo 10 días hábiles desde hoy (desde el ${formatFecha(minEntrega)}).`}
              </p>
            </div>

            <fieldset className="md:col-span-2">
              <legend className={labelClass}>
                Área destino <span className="text-destructive">*</span>
              </legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {AREAS.map((a) => (
                  <label key={a.email} className="cursor-pointer">
                    <input
                      type="radio"
                      name="area"
                      className="peer sr-only"
                      checked={a.email === areaDestino}
                      onChange={() => cambiarArea(a.email)}
                    />
                    <span className="flex min-h-12 flex-col items-center justify-center rounded-lg border border-border bg-card px-3 py-2 text-center transition-colors hover:bg-muted peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:ring-1 peer-checked:ring-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40">
                      <span className="text-sm font-semibold text-primary">
                        {a.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {a.email}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="md:col-span-2">
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
                Solo centros de {areaActual.label} ({centrosDelArea.length}{" "}
                disponibles).
              </p>
            </div>
          </div>

          <div className="mt-6 border-t border-border pt-5">
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-secondary">
              Clasificación y despacho
            </p>
            <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
              <div>
                <label htmlFor="clasificador1" className={labelClass}>
                  Clasificador 1 <span className="text-destructive">*</span>
                </label>
                <select
                  id="clasificador1"
                  className={fieldClass}
                  value={clasificador1}
                  onChange={(e) => setClasificador1(e.target.value)}
                >
                  <option value="">Selecciona…</option>
                  {CLASIFICADORES_1.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="clasificador2" className={labelClass}>
                  Clasificador 2 <span className="text-destructive">*</span>
                </label>
                <select
                  id="clasificador2"
                  className={fieldClass}
                  value={clasificador2}
                  onChange={(e) => setClasificador2(e.target.value)}
                >
                  <option value="">Selecciona…</option>
                  {CLASIFICADORES_2.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label htmlFor="despacho" className={labelClass}>
                  Despacho
                </label>
                <select
                  id="despacho"
                  className={fieldClass}
                  value={despacho}
                  disabled={urgente}
                  onChange={(e) => setDespacho(e.target.value)}
                >
                  <option value="">Opcional</option>
                  {OPCIONES_DESPACHO.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                {urgente && (
                  <p className="mt-1 text-xs font-medium text-warning">
                    Pedido urgente: siempre lo retira el solicitante.
                  </p>
                )}
              </div>
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
          description="Agrega una fila por artículo y escribe para buscarlo: se busca en todos, elijas o no una categoría."
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
            <button
              type="button"
              onClick={agregarLinea}
              className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground transition-colors hover:border-accent hover:bg-accent/5"
            >
              <span className="grid h-10 w-10 place-items-center rounded-full bg-accent/10 text-accent">
                <IconPlus />
              </span>
              <span className="mt-1 font-semibold text-primary">
                Agregar el primer artículo
              </span>
              <span>Aún no has agregado artículos.</span>
            </button>
          ) : (
            <>
              <div
                aria-hidden
                className={`hidden border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid md:gap-3 ${COLUMNAS_LINEA}`}
              >
                <span>Categoría</span>
                <span>Artículo</span>
                <span>Cantidad</span>
                <span />
              </div>
              <ul className="space-y-3 md:space-y-0">
                {lineas.map((l, idx) => {
                  // Sin categoría elegida, se busca entre todos los
                  // artículos; con categoría, se acota a esa categoría.
                  const artsLinea = l.categoria
                    ? articulosPorCategoria.get(l.categoria) ?? []
                    : todosLosArticulos;
                  return (
                    <li
                      key={l.id}
                      className={`rounded-xl border border-border bg-muted/30 p-3 md:grid md:items-start md:gap-3 md:rounded-none md:border-0 md:border-b md:border-border/70 md:bg-transparent md:px-0 md:py-2.5 md:last:border-b-0 ${COLUMNAS_LINEA}`}
                    >
                      <div className="mb-3 flex items-center justify-between md:hidden">
                        <span className="text-xs font-bold uppercase tracking-wide text-secondary">
                          Artículo {idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => quitarLinea(l.id)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10"
                          aria-label={`Quitar artículo ${idx + 1}`}
                        >
                          <IconTrash />
                          Quitar
                        </button>
                      </div>

                      <div className="mb-3 md:mb-0">
                        <span className={miniLabel}>Categoría</span>
                        <SearchCombobox
                          ariaLabel="Categoría del artículo"
                          placeholder="Buscar categoría…"
                          clearable
                          options={categorias.map((c) => ({
                            value: c.categoria,
                            label: `${c.categoria} (${c.articulos.length})`,
                          }))}
                          value={l.categoria}
                          onChange={(categoria) =>
                            categoria
                              ? cambiarCategoriaLinea(l.id, categoria)
                              : limpiarCategoriaLinea(l.id)
                          }
                        />
                      </div>

                      <div className="mb-3 md:mb-0">
                        <span className={miniLabel}>Artículo</span>
                        {l.manual ? (
                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              value={l.nombre}
                              onChange={(e) =>
                                cambiarNombreManual(l.id, e.target.value)
                              }
                              placeholder="Nombre del artículo…"
                              className={`${manualFieldClass} min-w-0 flex-1`}
                              aria-label="Nombre del artículo (fuera de catálogo)"
                            />
                            <input
                              type="text"
                              value={l.unidad}
                              onChange={(e) =>
                                cambiarUnidadManual(l.id, e.target.value)
                              }
                              placeholder="UN"
                              className={`${manualFieldClass} w-16 shrink-0 text-center`}
                              aria-label="Unidad de medida"
                              maxLength={10}
                            />
                          </div>
                        ) : (
                          <SearchCombobox
                            ariaLabel="Artículo"
                            placeholder={
                              l.categoria
                                ? "Buscar artículo (en esta categoría o escribe para buscar en todos)…"
                                : "Buscar en todos los artículos…"
                            }
                            clearable
                            options={artsLinea.map((a) => ({
                              value: a.codigo,
                              label: `${a.nombre} — ${a.codigo}`,
                            }))}
                            searchOptions={todosLosArticulos.map((a) => ({
                              value: a.codigo,
                              label: `${a.nombre} — ${a.codigo}`,
                            }))}
                            value={l.codigo}
                            onChange={(codigo) =>
                              cambiarArticuloLinea(l.id, codigo)
                            }
                          />
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            l.manual
                              ? desactivarArticuloManual(l.id)
                              : activarArticuloManual(l.id)
                          }
                          className="mt-1 text-xs font-semibold text-accent hover:underline"
                        >
                          {l.manual
                            ? "Volver a buscar en el catálogo"
                            : "¿No está en la lista? Escribirlo a mano"}
                        </button>
                      </div>

                      <div>
                        <span className={miniLabel}>Cantidad</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              cambiarCantidad(l.id, l.cantidad - 1)
                            }
                            disabled={l.cantidad <= 1}
                            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 md:h-9 md:w-9"
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
                            className="h-11 w-20 rounded-lg border border-border bg-card px-2 text-center text-base tabular-nums text-card-foreground outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 md:h-9 md:w-14 md:text-sm"
                            aria-label="Cantidad"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              cambiarCantidad(l.id, l.cantidad + 1)
                            }
                            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted md:h-9 md:w-9"
                            aria-label="Aumentar cantidad"
                          >
                            <IconPlus />
                          </button>
                          <span
                            className="ml-1 truncate text-xs text-muted-foreground md:max-w-[2rem]"
                            title={l.unidad}
                          >
                            {l.unidad || "—"}
                          </span>
                        </div>
                      </div>

                      <div className="hidden md:block">
                        <button
                          type="button"
                          onClick={() => quitarLinea(l.id)}
                          className="grid h-9 w-9 place-items-center rounded-md text-destructive transition-colors hover:bg-destructive/10"
                          aria-label={`Quitar artículo ${idx + 1}`}
                          title="Quitar"
                        >
                          <IconTrash />
                        </button>
                      </div>

                      <div className="mt-2 md:col-span-4 md:mt-1.5">
                        <span className={miniLabel}>
                          Comentario del artículo
                        </span>
                        <input
                          type="text"
                          value={l.comentario}
                          onChange={(e) =>
                            cambiarComentarioLinea(l.id, e.target.value)
                          }
                          placeholder="Detalle de este artículo (opcional): medida, color, para qué equipo…"
                          className={`${manualFieldClass} w-full`}
                          aria-label={`Comentario del artículo ${idx + 1}`}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={agregarLinea}
                className={`${botonSecundario} mt-4 w-full sm:w-auto`}
              >
                <IconPlus />
                Agregar artículo
              </button>
            </>
          )}
        </SectionCard>
      </div>

      {/* Resumen y acciones: columna fija a la derecha en pantallas grandes */}
      <aside className="min-w-0 space-y-4 xl:sticky xl:top-24">
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-bold text-primary">Resumen del pedido</h2>
          <dl className="mt-3 divide-y divide-border/70 text-sm">
            <FilaResumen label="Para">
              <span className="break-all">{para}</span>
            </FilaResumen>
            <FilaResumen label="CC">
              <span className="break-all">{cc}</span>
            </FilaResumen>
            <FilaResumen label="Área">{areaActual.label}</FilaResumen>
            <FilaResumen label="Centro">{centroDesc || "—"}</FilaResumen>
            <FilaResumen label="Entrega">
              {formatFecha(fechaEntrega) || "—"}
              {urgente && (
                <span className="ml-2 rounded-full bg-warning-surface px-2 py-0.5 text-xs font-bold text-warning">
                  Urgente
                </span>
              )}
            </FilaResumen>
            <FilaResumen label="Artículos">
              {lineasCompletas.length} ·{" "}
              {unidadesCompletas.toLocaleString("es-CL")} unidades
            </FilaResumen>
          </dl>

          {faltante && (
            <p
              role="status"
              className="mt-4 flex items-start gap-2 rounded-lg bg-warning-surface px-3 py-2 text-xs font-medium text-warning"
            >
              <span className="mt-px shrink-0">
                <IconWarning />
              </span>
              {faltante}
            </p>
          )}

          <button
            type="button"
            onClick={() => setConfirmando(true)}
            disabled={!puedeEnviar || registrando}
            className="mt-4 hidden h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 xl:inline-flex"
          >
            <IconMail />
            {registrando ? "Registrando…" : "Registrar y abrir correo en Gmail"}
          </button>

          <p className="mt-3 rounded-lg bg-warning-surface px-3 py-2 text-xs leading-relaxed text-warning">
            <span className="font-bold">Importante:</span> una vez que presiones
            «Sí, enviar» no podrás editar el pedido ni el correo, y tendrás que
            enviarlo sí o sí. Revisa bien los detalles tal como se muestran y,
            cuando estés seguro, envía el correo para que el pedido quede
            registrado correctamente en la planilla de Pedidos.
          </p>
        </section>

        {puedeEnviar && (
          <details className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
            <summary className="cursor-pointer font-semibold text-primary">
              Vista previa del correo
            </summary>
            <p className="mt-3 text-xs font-semibold text-muted-foreground">
              Asunto: <span className="font-normal">{asunto}</span>
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs text-card-foreground">
              {cuerpoCorreo}
            </pre>
          </details>
        )}
      </aside>

      {/* Barra fija para celular y tablet: el botón principal siempre a mano */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur xl:hidden">
        <p
          role="status"
          className={`mb-2 truncate text-xs ${
            faltante ? "font-medium text-warning" : "text-muted-foreground"
          }`}
        >
          {faltante ??
            `${lineasCompletas.length} ${
              lineasCompletas.length === 1 ? "artículo" : "artículos"
            } · ${unidadesCompletas.toLocaleString("es-CL")} unidades`}
        </p>
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          disabled={!puedeEnviar || registrando}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconMail />
          {registrando ? "Registrando…" : "Registrar y abrir correo en Gmail"}
        </button>
      </div>

      {confirmando && (
        <ConfirmarEnvioDialog
          resumen={resumenEnvio}
          enviando={registrando}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={registrarYAbrir}
        />
      )}
    </div>
  );
}

function FilaResumen({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 text-right font-medium text-card-foreground">
        {children}
      </dd>
    </div>
  );
}
