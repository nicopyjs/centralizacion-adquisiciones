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

// Pedido copiado desde «Pedidos del Área» (ver MisPedidosPanel).
const CLAVE_REPETIR = "repetirPedido";

type PedidoACopiar = {
  pedidoId: string;
  solicitante: string;
  area: string;
  centroCodigo: string;
  clasificador1: string;
  clasificador2: string;
  despacho: string;
  comentario: string;
  items: {
    categoria: string;
    codigo: string;
    nombre: string;
    unidad: string;
    cantidad: number;
    comentarioArticulo: string;
  }[];
};

// Borradores guardados en este navegador (no pasan por la planilla).
const CLAVE_BORRADORES = "borradoresPedido";
const MAX_BORRADORES = 20;

type DatosBorrador = {
  solicitante: string;
  areaDestino: string;
  centroSel: string;
  clasificador1: string;
  clasificador2: string;
  despacho: string;
  fechaEntrega: string;
  urgente: boolean;
  comentario: string;
  lineas: LineaPedido[];
};

type Borrador = {
  id: string;
  titulo: string;
  guardadoEn: string;
  datos: DatosBorrador;
};

function leerBorradores(): Borrador[] {
  try {
    const raw = localStorage.getItem(CLAVE_BORRADORES);
    const lista = raw ? (JSON.parse(raw) as Borrador[]) : [];
    return Array.isArray(lista)
      ? lista.filter((b) => b && b.id && b.datos && Array.isArray(b.datos.lineas))
      : [];
  } catch {
    return [];
  }
}

function escribirBorradores(lista: Borrador[]): boolean {
  try {
    localStorage.setItem(CLAVE_BORRADORES, JSON.stringify(lista));
    return true;
  } catch {
    return false;
  }
}

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
const MAX_ADJUNTOS = 3;
const MAX_BYTES_ADJUNTOS = 4 * 1024 * 1024;
const EXT_ADJUNTOS = /\.(pdf|xlsx|xls|csv|docx|doc|png|jpe?g)$/i;
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
  { label: "Transición y Postventa", email: "typ@nebchile.cl", prefijo: "TYP" },
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
  asunto: string;
  cuerpo: string;
  urgente: boolean;
  adjuntos: string[];
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
  porApi,
  onCancelar,
  onConfirmar,
}: {
  resumen: ResumenEnvio;
  enviando: boolean;
  /** true si el correo sale solo por la Gmail API (cuenta Google conectada). */
  porApi: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const volverRef = useRef<HTMLButtonElement>(null);
  const [vista, setVista] = useState<"correo" | "resumen">("correo");
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
  if (resumen.adjuntos.length) datos.push(["Adjuntos", resumen.adjuntos.join(", ")]);

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
              {porApi
                ? "Al confirmar se registra en la planilla y el correo se envía de inmediato a Adquisiciones desde tu cuenta. No podrás editarlo ni agregar archivos después."
                : "Al confirmar se registra en la planilla y se abre el correo listo para enviar. No podrás editarlo: tendrás que enviarlo sí o sí."}
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {resumen.urgente && (
            <p className="mb-3 rounded-lg bg-warning-surface px-3 py-2 text-sm font-bold text-warning">
              Este pedido se enviará como URGENTE.
            </p>
          )}
          <div
            role="tablist"
            aria-label="Qué revisar"
            className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm font-semibold"
          >
            {(
              [
                ["correo", "Correo a enviar"],
                ["resumen", "Resumen"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={vista === id}
                onClick={() => setVista(id)}
                className={`h-9 rounded-md transition-colors ${
                  vista === id
                    ? "bg-card text-primary shadow-sm"
                    : "text-muted-foreground hover:text-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {vista === "correo" ? (
            <EmailPreview
              para={resumen.para}
              cc={resumen.cc}
              asunto={resumen.asunto}
              cuerpo={resumen.cuerpo}
            />
          ) : (
          <>
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
          </>
          )}
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

/** Correo tal como lo verá Gmail: Para / CC / Asunto y cuerpo en texto plano. */
function EmailPreview({
  para,
  cc,
  asunto,
  cuerpo,
  cuerpoClassName = "",
}: {
  para: string;
  cc: string;
  asunto: string;
  cuerpo: string;
  cuerpoClassName?: string;
}) {
  const cabecera: [string, string][] = [
    ["Para", para],
    ["CC", cc],
    ["Asunto", asunto],
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <dl className="divide-y divide-border/70 bg-muted/40 text-xs">
        {cabecera.map(([k, v]) => (
          <div key={k} className="flex gap-3 px-3 py-1.5">
            <dt className="w-12 shrink-0 font-semibold text-muted-foreground">
              {k}
            </dt>
            <dd className="min-w-0 break-words font-medium text-card-foreground">
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <pre
        className={`whitespace-pre-wrap break-words border-t border-border px-3 py-3 font-sans text-[13px] leading-relaxed text-card-foreground ${cuerpoClassName}`}
      >
        {cuerpo}
      </pre>
    </div>
  );
}

function SectionCard({
  step,
  title,
  description,
  id,
  children,
}: {
  id?: string;
  step: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6"
    >
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

function IconCheck({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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
  // Cuenta Google conectada (envío por la Gmail API). null = no conectada.
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [avisoGoogle, setAvisoGoogle] = useState<string | null>(null);
  // Archivos para adjuntar al correo (solo con la cuenta Google conectada).
  const [adjuntos, setAdjuntos] = useState<File[]>([]);
  const [errorAdjuntos, setErrorAdjuntos] = useState<string | null>(null);
  const inputAdjuntos = useRef<HTMLInputElement>(null);
  // Resultado del envío por la API: desde qué cuenta salió, o el error.
  const [correoEnviado, setCorreoEnviado] = useState<
    { ok: true; desde: string } | { ok: false; error: string } | null
  >(null);
  // Se activa al intentar enviar con campos faltantes: marca los vacíos en rojo.
  const [mostrarErrores, setMostrarErrores] = useState(false);
  // Fila recién agregada: su buscador de artículo recibe el foco al montarse.
  const [lineaNuevaId, setLineaNuevaId] = useState<string | null>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelado = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelado) setGoogleEmail(d?.googleEmail ?? null);
      })
      .catch(() => {});
    // Regreso del login de Google: ?google=ok | ?google=error&motivo=...
    const q = new URLSearchParams(window.location.search);
    const g = q.get("google");
    if (g) {
      const motivos: Record<string, string> = {
        dominio: "Usa tu cuenta @nebchile.cl.",
        permisos: "Debes aceptar el permiso para enviar correos.",
        cancelado: "Cancelaste la conexión con Google.",
        config: "El login con Google no está configurado.",
      };
      setTimeout(() => {
        setAvisoGoogle(
          g === "ok"
            ? null
            : motivos[q.get("motivo") ?? ""] ??
                "No se pudo conectar con Google. Inténtalo de nuevo."
        );
      }, 0);
      window.history.replaceState(null, "", window.location.pathname);
    }
    return () => {
      cancelado = true;
    };
  }, []);
  // Folio del pedido del que se copiaron los datos (aviso informativo).
  const [copiadoDe, setCopiadoDe] = useState<string | null>(null);
  // Borradores del navegador y el que se está editando (si viene de uno).
  const [borradores, setBorradores] = useState<Borrador[]>([]);
  const [borradorId, setBorradorId] = useState<string | null>(null);
  const [avisoBorrador, setAvisoBorrador] = useState<string | null>(null);

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

  // «Repetir pedido»: si viene un pedido guardado desde Pedidos del Área, se
  // precarga el formulario (la fecha de entrega y la urgencia quedan por
  // defecto). Se lee una sola vez y se borra para no repetirlo al recargar.
  useEffect(() => {
    let pedido: PedidoACopiar | null = null;
    try {
      const raw = sessionStorage.getItem(CLAVE_REPETIR);
      if (!raw) return;
      sessionStorage.removeItem(CLAVE_REPETIR);
      pedido = JSON.parse(raw) as PedidoACopiar;
    } catch {
      return;
    }
    if (!pedido || !Array.isArray(pedido.items)) return;
    const area = AREAS.find(
      (a) => a.label.toLowerCase() === (pedido.area ?? "").trim().toLowerCase()
    );
    /* eslint-disable react-hooks/set-state-in-effect -- sessionStorage solo existe en el cliente */
    if (area) setAreaDestino(area.email);
    setSolicitante(pedido.solicitante ?? "");
    setCentroSel(pedido.centroCodigo ?? "");
    setClasificador1(pedido.clasificador1 ?? "");
    setClasificador2(pedido.clasificador2 ?? "");
    setDespacho(pedido.despacho ?? "");
    setComentario(pedido.comentario ?? "");
    setLineas(
      pedido.items.map((it) => ({
        id: nuevaLineaId(),
        categoria: it.categoria ?? "",
        codigo: it.codigo,
        nombre: it.nombre,
        unidad: it.unidad,
        cantidad: it.cantidad,
        manual: it.codigo === CODIGO_MANUAL,
        comentario: it.comentarioArticulo ?? "",
      }))
    );
    setCopiadoDe(pedido.pedidoId);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- localStorage solo existe en el cliente */
    setBorradores(leerBorradores());
    /* eslint-enable react-hooks/set-state-in-effect */
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
    const id = nuevaLineaId();
    setLineaNuevaId(id);
    setLineas((prev) => [
      ...prev,
      {
        id,
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
  const fechaInvalida = Boolean(fechaEntrega && fechaEntrega < minEntrega);
  const errores = mostrarErrores;
  const claseCampo = (invalido: boolean) =>
    invalido ? fieldClass.replace("border-border", "border-destructive") : fieldClass;

  /** Con el pedido incompleto no envía: marca lo faltante y lleva al primero. */
  function intentarEnviar() {
    if (puedeEnviar) {
      setConfirmando(true);
      return;
    }
    setMostrarErrores(true);
    const idPrimero = !solicitante.trim()
      ? "solicitante"
      : !centroSel
        ? "centro"
        : !clasificador1
          ? "clasificador1"
          : !clasificador2
            ? "clasificador2"
            : lineasCompletas.length === 0
              ? "seccion-articulos"
              : "fechaEntrega";
    const el = document.getElementById(idPrimero);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (idPrimero !== "seccion-articulos") el?.focus({ preventScroll: true });
  }

  const requisitos = [
    { label: "Solicitante", ok: solicitante.trim().length > 0 },
    { label: "Centro de negocio", ok: Boolean(centroSel) },
    { label: "Clasificador 1", ok: Boolean(clasificador1) },
    { label: "Clasificador 2", ok: Boolean(clasificador2) },
    { label: "Al menos un artículo con cantidad", ok: lineasCompletas.length > 0 },
  ];

  const comentarioAsunto = comentario.replace(/\s+/g, " ").trim();
  const asunto = `NEB Chile // Adquisiciones // ${centroDesc}${
    comentarioAsunto ? ` // ${comentarioAsunto}` : ""
  }`;

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
        const base = `- ${l.cantidad.toLocaleString("es-CL")} ${l.unidad ? `${l.unidad} ` : ""}${l.nombre}`;
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
  function construirCorreo(folio?: string): CorreoGmail {
    // El folio distingue en la bandeja pedidos con asuntos idénticos.
    const asuntoFinal = folio
      ? asunto.replace("Adquisiciones //", `Adquisiciones // Pedido ${folio} //`)
      : asunto;
    const cuerpoFinal = folio
      ? cuerpoCorreo.replace(
          "solicito gestión del siguiente pedido:",
          `solicito gestión del siguiente pedido (folio ${folio}):`
        )
      : cuerpoCorreo;
    const url =
      "https://mail.google.com/a/nebchile.cl/mail/?view=cm&fs=1" +
      `&to=${encodeURIComponent(para)}` +
      `&cc=${encodeURIComponent(cc)}` +
      `&su=${encodeURIComponent(asuntoFinal)}` +
      `&body=${encodeURIComponent(cuerpoFinal)}`;
    return {
      para,
      cc,
      asunto: asuntoFinal,
      cuerpoCorreo: cuerpoFinal,
      gmailUrl: url,
    };
  }

  const correoActual: CorreoGmail = construirCorreo();

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
    const correoFinal = resultado.ok
      ? construirCorreo(resultado.folio)
      : correoActual;
    // Con la cuenta Google conectada, el correo sale por la Gmail API.
    let enviadoPorApi = false;
    setCorreoEnviado(null);
    if (resultado.ok && googleEmail) {
      try {
        const form = new FormData();
        form.set("folio", resultado.folio);
        form.set("cc", correoFinal.cc);
        form.set("asunto", correoFinal.asunto);
        form.set("cuerpo", correoFinal.cuerpoCorreo);
        for (const f of adjuntos) form.append("archivo", f);
        const res = await fetch("/api/pedidos/correo", {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (res.ok) {
          enviadoPorApi = true;
          setCorreoEnviado({ ok: true, desde: data.desde as string });
        } else {
          if (data.reconectar) setGoogleEmail(null);
          setCorreoEnviado({
            ok: false,
            error:
              (data.error || "No se pudo enviar el correo.") +
              (adjuntos.length ? " Recuerda adjuntar los archivos en Gmail." : ""),
          });
        }
      } catch {
        setCorreoEnviado({ ok: false, error: "Error de red al enviar el correo." });
      }
    }
    if (resultado.ok) {
      // Copia del correo para «Abrir Gmail» y limpieza de los campos, así el
      // pedido no se puede volver a registrar por error.
      setCorreoRegistrado(correoFinal);
      // El borrador de origen ya se envió: deja de ofrecerse.
      if (borradorId) eliminarBorrador(borradorId);
      setBorradorId(null);
      setAvisoBorrador(null);
      limpiarCampos();
    }
    // Deja visible el aviso de resultado (con «Abrir Gmail» por si el sistema
    // bloquea la apertura automática) y abre el correo.
    bannerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Si no salió por la API, se abre Gmail como siempre.
    if (!enviadoPorApi) abrirGmail(correoFinal);
  }

  const hayAlgoQueGuardar =
    lineas.length > 0 ||
    centroSel !== "" ||
    comentario.trim() !== "" ||
    clasificador1 !== "" ||
    clasificador2 !== "";

  /** Guarda (o actualiza) el pedido a medias como borrador de este navegador. */
  function guardarBorrador() {
    if (!hayAlgoQueGuardar) return;
    const id = borradorId ?? `borrador-${Date.now()}`;
    const completas = lineas.filter((l) => l.codigo).length;
    const titulo = `${centroDesc || areaActual.label} · ${completas} ${
      completas === 1 ? "artículo" : "artículos"
    }`;
    const nuevo: Borrador = {
      id,
      titulo,
      guardadoEn: new Date().toISOString(),
      datos: {
        solicitante,
        areaDestino,
        centroSel,
        clasificador1,
        clasificador2,
        despacho,
        fechaEntrega,
        urgente,
        comentario,
        lineas,
      },
    };
    const resto = leerBorradores().filter((b) => b.id !== id);
    const lista = [nuevo, ...resto].slice(0, MAX_BORRADORES);
    if (escribirBorradores(lista)) {
      setBorradores(lista);
      setBorradorId(id);
      setAvisoBorrador("Borrador guardado en este navegador.");
    } else {
      setAvisoBorrador(
        "No se pudo guardar el borrador (el navegador bloqueó el almacenamiento)."
      );
    }
  }

  function continuarBorrador(b: Borrador) {
    const d = b.datos;
    setAreaDestino(d.areaDestino || AREAS[0].email);
    setSolicitante(d.solicitante ?? "");
    setCentroSel(d.centroSel ?? "");
    setClasificador1(d.clasificador1 ?? "");
    setClasificador2(d.clasificador2 ?? "");
    setDespacho(d.despacho ?? "");
    setComentario(d.comentario ?? "");
    setUrgente(d.urgente === true);
    // Una fecha ya vencida (o anterior al mínimo de un pedido normal) vuelve
    // al valor por defecto.
    const minimo = d.urgente ? toInputDate(new Date()) : fechaEntregaPorDefecto();
    setFechaEntrega(
      d.fechaEntrega && d.fechaEntrega >= minimo ? d.fechaEntrega : fechaEntregaPorDefecto()
    );
    setLineas(d.lineas.map((l) => ({ ...l, id: nuevaLineaId() })));
    setBorradorId(b.id);
    setCopiadoDe(null);
    setRegistro(null);
    setMostrarErrores(false);
    setAvisoBorrador(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function eliminarBorrador(id: string) {
    const lista = leerBorradores().filter((b) => b.id !== id);
    escribirBorradores(lista);
    setBorradores(lista);
    if (borradorId === id) setBorradorId(null);
  }

  /** Vacía el pedido; conserva solicitante y área. */
  function limpiarCampos() {
    setMostrarErrores(false);
    setLineas([]);
    setCentroSel("");
    setClasificador1("");
    setClasificador2("");
    setDespacho("");
    setComentario("");
    setAdjuntos([]);
    setErrorAdjuntos(null);
    setFechaEntrega(fechaEntregaPorDefecto());
    setUrgente(false);
  }

  function elegirAdjuntos(lista: FileList | null) {
    if (!lista) return;
    const sig = [...adjuntos, ...Array.from(lista)];
    if (sig.length > MAX_ADJUNTOS) {
      setErrorAdjuntos(`Máximo ${MAX_ADJUNTOS} archivos.`);
    } else if (sig.reduce((s, f) => s + f.size, 0) > MAX_BYTES_ADJUNTOS) {
      setErrorAdjuntos("Los archivos superan el máximo de 4 MB en total.");
    } else if (
      sig.some((f) => !EXT_ADJUNTOS.test(f.name))
    ) {
      setErrorAdjuntos("Solo PDF, Excel, Word, CSV o imágenes (PNG/JPG).");
    } else {
      setErrorAdjuntos(null);
      setAdjuntos(sig);
    }
    if (inputAdjuntos.current) inputAdjuntos.current.value = "";
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
    asunto,
    cuerpo: cuerpoCorreo,
    urgente,
    adjuntos: adjuntos.map((f) => f.name),
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
    <div className="grid items-start gap-6 pb-44 xl:grid-cols-[minmax(0,1fr)_400px] xl:pb-0 2xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="min-w-0 space-y-6">
        {copiadoDe && !registro && (
          <div
            role="status"
            className="flex items-start justify-between gap-3 rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm text-card-foreground"
          >
            <p>
              <span className="font-bold">Copiado del pedido {copiadoDe}.</span>{" "}
              Revisa los datos y artículos, cambia lo que necesites y registra el
              pedido. La fecha de entrega quedó con el valor por defecto.
            </p>
            <button
              type="button"
              onClick={() => setCopiadoDe(null)}
              className="shrink-0 text-xs font-semibold text-accent hover:underline"
            >
              Cerrar
            </button>
          </div>
        )}
        {borradores.length > 0 && !registro && (
          <section
            aria-label="Borradores guardados"
            className="rounded-xl border border-border bg-card p-4 shadow-sm"
          >
            <h2 className="text-sm font-bold text-primary">
              Borradores guardados ({borradores.length})
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Quedan en este navegador. Continúa uno para completarlo y enviarlo.
            </p>
            <ul className="mt-3 divide-y divide-border">
              {borradores.map((b) => (
                <li
                  key={b.id}
                  className={`flex flex-wrap items-center justify-between gap-2 py-2 ${
                    b.id === borradorId ? "font-semibold" : ""
                  }`}
                >
                  <span className="min-w-0 text-sm text-card-foreground">
                    <span className="block truncate">{b.titulo}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {b.datos.solicitante || "Sin solicitante"} ·{" "}
                      {new Date(b.guardadoEn).toLocaleString("es-CL", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {b.id === borradorId ? " · en edición" : ""}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => continuarBorrador(b)}
                      className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted"
                    >
                      Continuar
                    </button>
                    <button
                      type="button"
                      onClick={() => eliminarBorrador(b.id)}
                      className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-destructive hover:underline"
                    >
                      Eliminar
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 text-sm shadow-sm sm:px-4"
        >
          <p className="min-w-0 text-card-foreground/80">
            {googleEmail ? (
              <>
                El correo del pedido se enviará desde{" "}
                <strong className="text-primary">{googleEmail}</strong>.
              </>
            ) : (
              <>
                Conecta tu cuenta de Google para que la app envíe el correo por
                ti. Sin conectar, se abrirá Gmail para que lo envíes a mano.
              </>
            )}
            {avisoGoogle && (
              <span className="mt-1 block font-semibold text-warning">
                {avisoGoogle}
              </span>
            )}
          </p>
          {googleEmail ? (
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/auth/google/logout", { method: "POST" });
                setGoogleEmail(null);
              }}
              className={botonSecundario}
            >
              Desconectar
            </button>
          ) : (
            <a
              href={`/api/auth/google/login?volver=${encodeURIComponent(
                typeof window === "undefined" ? "/enviar-pedido" : window.location.pathname
              )}`}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover"
            >
              <IconMail />
              Conectar con Google
            </a>
          )}
        </div>
        {googleEmail && !registro && (
          <div
            role="note"
            className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning-surface p-3 text-sm sm:px-4"
          >
            <span
              aria-hidden
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-warning text-accent-foreground"
            >
              <IconWarning />
            </span>
            <div className="min-w-0 text-card-foreground/90">
              <p className="font-bold text-warning">Cambió la forma de enviar el pedido</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>
                  Ahora, al presionar <strong>«Revisar y enviar pedido»</strong> y
                  confirmar, el pedido <strong>se envía directo por correo</strong>{" "}
                  desde tu cuenta. Ya no se abre Gmail para revisarlo antes.
                </li>
                <li>
                  Si necesitas <strong>adjuntar archivos</strong> (PDF, Excel…),
                  hazlo <strong>aquí mismo en la página</strong>, en «Archivos
                  adjuntos» (sección Datos del pedido), <strong>antes</strong> de
                  enviar. Después no se pueden agregar.
                </li>
              </ul>
            </div>
          </div>
        )}
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
                  {!registro.ok
                    ? `${registro.error} El correo se abrió igual; si no lo ves, toca «Abrir Gmail».`
                    : correoEnviado?.ok
                      ? `Correo enviado a Adquisiciones desde ${correoEnviado.desde}.`
                      : correoEnviado
                        ? `${correoEnviado.error} Se abrió Gmail para que lo envíes a mano; si no lo ves, toca «Abrir Gmail».`
                        : "Si Gmail no se abrió solo, toca «Abrir Gmail». Revisa el correo y presiona Enviar."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!correoEnviado?.ok && (
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
                  )}
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
                invalid={errores && !solicitante.trim()}
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
                className={claseCampo(errores && fechaInvalida)}
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
                invalid={errores && !centroSel}
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
                  className={claseCampo(errores && !clasificador1)}
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
                  className={claseCampo(errores && !clasificador2)}
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

          <div className="mt-4">
            <span className={labelClass}>Archivos adjuntos</span>
            {googleEmail ? (
              <>
                <input
                  ref={inputAdjuntos}
                  type="file"
                  multiple
                  accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={(e) => elegirAdjuntos(e.target.files)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => inputAdjuntos.current?.click()}
                    disabled={adjuntos.length >= MAX_ADJUNTOS}
                    className={botonSecundario}
                  >
                    Adjuntar archivo
                  </button>
                  <span className="text-xs text-muted-foreground">
                    PDF, Excel, Word, CSV o imagen · máx. {MAX_ADJUNTOS}{" "}
                    archivos y 4 MB en total.
                  </span>
                </div>
                {adjuntos.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {adjuntos.map((f, i) => (
                      <li
                        key={`${f.name}-${i}`}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          {f.name}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({Math.max(1, Math.round(f.size / 1024))} KB)
                          </span>
                        </span>
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
                  <p role="alert" className="mt-1.5 text-xs font-semibold text-destructive">
                    {errorAdjuntos}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Conecta tu cuenta de Google (arriba) para adjuntar archivos al
                correo. Sin conectar, adjúntalos a mano en Gmail.
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard
          id="seccion-articulos"
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
              className={`flex w-full flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground transition-colors hover:border-accent hover:bg-accent/5 ${
                errores ? "border-destructive" : "border-border"
              }`}
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
                            autoFocus={l.id === lineaNuevaId}
                            invalid={errores && !l.codigo}
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

      {/* Resumen, requisitos y vista previa: columna fija a la derecha en pantallas grandes */}
      <aside className="min-w-0 space-y-4 xl:sticky xl:top-24 xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto xl:pr-1">
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-primary">Tu pedido</h2>
            <span className="text-xs font-semibold text-muted-foreground">
              {lineasCompletas.length}{" "}
              {lineasCompletas.length === 1 ? "artículo" : "artículos"} ·{" "}
              {unidadesCompletas.toLocaleString("es-CL")} un.
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {areaActual.label} · entrega {formatFecha(fechaEntrega) || "—"}
            {urgente && (
              <span className="ml-2 rounded-full bg-warning-surface px-2 py-0.5 font-bold text-warning">
                Urgente
              </span>
            )}
          </p>

          <ul className="mt-3 space-y-1.5 text-sm">
            {requisitos.map((r) => (
              <li
                key={r.label}
                className={`flex items-center gap-2 ${
                  r.ok
                    ? "text-card-foreground"
                    : errores
                      ? "text-destructive"
                      : "text-muted-foreground"
                }`}
              >
                <span
                  aria-hidden
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                    r.ok
                      ? "bg-success text-accent-foreground"
                      : errores
                        ? "border border-destructive"
                        : "border border-border"
                  }`}
                >
                  {r.ok && <IconCheck size={12} />}
                </span>
                <span className={r.ok ? "" : "font-medium"}>{r.label}</span>
                <span className="sr-only">{r.ok ? "(listo)" : "(falta)"}</span>
              </li>
            ))}
          </ul>

          {fechaInvalida && (
            <p
              role="status"
              className="mt-3 flex items-start gap-2 rounded-lg bg-warning-surface px-3 py-2 text-xs font-medium text-warning"
            >
              <span className="mt-px shrink-0">
                <IconWarning />
              </span>
              La fecha de entrega debe ser desde el {formatFecha(minEntrega)} (10
              días hábiles). Marca «Pedido urgente» para elegir una anterior.
            </p>
          )}

          <button
            type="button"
            onClick={intentarEnviar}
            disabled={registrando}
            data-incompleto={!puedeEnviar || undefined}
            className="mt-4 hidden h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 data-[incompleto]:opacity-60 xl:inline-flex"
          >
            <IconMail />
            {registrando
              ? "Registrando…"
              : googleEmail
                ? "Revisar y enviar pedido"
                : "Revisar y enviar por Gmail"}
          </button>

          <button
            type="button"
            onClick={guardarBorrador}
            disabled={!hayAlgoQueGuardar || registrando}
            className={`${botonSecundario} mt-2 hidden w-full xl:inline-flex`}
          >
            {borradorId ? "Actualizar borrador" : "Guardar como borrador"}
          </button>
          {avisoBorrador && (
            <p
              role="status"
              className="mt-2 hidden text-center text-xs text-muted-foreground xl:block"
            >
              {avisoBorrador}
            </p>
          )}

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-bold text-warning">Importante:</span> al
            confirmar no podrás editar el pedido
            {googleEmail
              ? " y el correo se enviará de inmediato."
              : " y tendrás que enviar el correo sí o sí."}
          </p>
        </section>

        <section
          id="vista-previa"
          className="scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-sm"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-primary">
              Vista previa del correo
            </h2>
            <span className="text-xs text-muted-foreground">
              Se actualiza al escribir
            </span>
          </div>
          <EmailPreview
            para={para}
            cc={cc}
            asunto={asunto}
            cuerpo={cuerpoCorreo}
            cuerpoClassName="max-h-96 overflow-y-auto"
          />
        </section>
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
          onClick={intentarEnviar}
          disabled={registrando}
          data-incompleto={!puedeEnviar || undefined}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 data-[incompleto]:opacity-60"
        >
          <IconMail />
          {registrando
              ? "Registrando…"
              : googleEmail
                ? "Revisar y enviar pedido"
                : "Revisar y enviar por Gmail"}
        </button>
        <div className="mt-1 flex items-center justify-center gap-4 text-xs font-semibold">
          <button
            type="button"
            onClick={guardarBorrador}
            disabled={!hayAlgoQueGuardar || registrando}
            className="text-accent hover:underline disabled:opacity-40"
          >
            {borradorId ? "Actualizar borrador" : "Guardar borrador"}
          </button>
          <a href="#vista-previa" className="text-accent hover:underline">
            Ver vista previa del correo
          </a>
        </div>
        {avisoBorrador && (
          <p role="status" className="mt-1 text-center text-xs text-muted-foreground">
            {avisoBorrador}
          </p>
        )}
      </div>

      {confirmando && (
        <ConfirmarEnvioDialog
          resumen={resumenEnvio}
          enviando={registrando}
          porApi={googleEmail !== null}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={registrarYAbrir}
        />
      )}
    </div>
  );
}
