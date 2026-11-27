"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import SearchCombobox, { type ComboOption } from "./SearchCombobox";
import ChatPedido, { InsigniaChat, useChatNoLeidos } from "@/components/ChatPedido";
import CorreoFaltante from "@/components/CorreoFaltante";
import ReportarCorreo from "@/components/ReportarCorreo";
import { yaConsumido, yaRecepcionado } from "@/lib/marcas-inventario";
import { CLASIFICADORES_1, CLASIFICADORES_2 } from "@/lib/clasificadores";
import { fechaEntregaAYMD } from "@/lib/fechas";
import {
  AVISO_RECEPCION,
  CODIGO_ARTICULO_MANUAL,
  ESTADOS_OC_ASOCIABLES,
  problemasPorRecibir,
  problemasRecepcion,
  type LineaOC,
} from "@/lib/defontana";

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
  /** Fecha en que el pedido llega a bodega de Adquisiciones ("YYYY-MM-DD"). Editable. */
  fechaRecepcionBodega: string;
  /** Fecha en que se entrega al solicitante/supervisor ("YYYY-MM-DD"). Editable. */
  fechaEntregaSolicitante: string;
  /** Comentario/detalle propio de este artículo, escrito al armar el pedido. */
  comentarioArticulo: string;
  /** Artículo anulado por Adquisiciones: no cuenta como pedido ni se recibe. */
  anulado: boolean;
  motivoAnulacion: string;
  /** N° de la OC de Defontana asociada a este artículo ("" = en gestión). */
  ocAsociada: string;
};

/** Datos de una OC de Defontana, para mostrarla junto al artículo. */
type InfoOC = { proveedor: string; fecha: string; estado: string } | null;

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
  /** Cierre/anulación decidido por Adquisiciones; vacío = según lo recibido. */
  estadoManual: "" | "cerrado" | "anulado";
  motivoEstado: string;
  /** El correo de solicitud no salió: se ofrece enviarlo. */
  sinCorreo?: boolean;
  items: PedidoItem[];
};

type Estado = "pendiente" | "parcial" | "completo" | "cerrado" | "anulado";
type Alerta = "urgentes" | "atrasados";
type Filtro = "porAtender" | "todos" | Alerta | Estado;

/** Estados que activa la vista rápida «Por atender» (y el filtro por defecto). */
// Áreas del pedido (etiqueta guardada en la planilla) y prefijo de sus centros.
const AREAS_PEDIDO = [
  { label: "Refacciones", prefijo: "RCT" },
  { label: "Servicio Técnico", prefijo: "SST" },
  { label: "Instalaciones", prefijo: "INT" },
  { label: "Transición y Postventa", prefijo: "TYP" },
];

const ESTADOS_POR_ATENDER: Estado[] = ["pendiente", "parcial"];

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
  cerrado: {
    label: "Cerrado",
    chip: "bg-muted text-secondary",
    dot: "bg-secondary",
  },
  anulado: {
    label: "Anulado",
    chip: "bg-destructive/10 text-destructive",
    dot: "bg-destructive/50",
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

/** Folios largos autogenerados (PED-1792003781685) se acortan a sus últimos 6 dígitos. */
function folioCorto(id: string): string {
  const m = /^PED-(\d{9,})$/.exec(id.trim());
  return m ? `PED-…${m[1].slice(-6)}` : id;
}

/** "YYYY-MM-DD" -> Date a medianoche local (sin desfase de huso horario). */
function parseFechaYMD(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const fecha = new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function estadoLinea(it: PedidoItem): Estado {
  if (it.cantidadRecibida === null) return "pendiente";
  return it.cantidadRecibida >= it.cantidad ? "completo" : "parcial";
}

function estadoPedido(todos: PedidoItem[]): Estado {
  // Los artículos anulados no cuentan: el pedido se completa con los vigentes.
  const items = todos.filter((it) => !it.anulado);
  if (items.length === 0 || items.every((it) => it.cantidadRecibida === null))
    return "pendiente";
  return items.every((it) => estadoLinea(it) === "completo")
    ? "completo"
    : "parcial";
}

/** Estado efectivo: el cierre/anulación manual manda sobre lo recibido. */
function estadoDe(p: PedidoResumen): Estado {
  return p.estadoManual || estadoPedido(p.items);
}

/** Urgente y todavía sin recibir por completo: lo que hay que atender primero. */
function esUrgentePendiente(p: PedidoResumen): boolean {
  return p.urgente && ["pendiente", "parcial"].includes(estadoDe(p));
}

/** La "Fecha de entrega" del pedido se guarda como texto "DD-MM-YY". */
function parseFechaEntrega(s: string): Date | null {
  const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (m) {
    const [, d, mo, y] = m;
    const fecha = new Date(2000 + Number(y), Number(mo) - 1, Number(d));
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }
  // Sheets a veces la guarda como "AAAA-MM-DD" o como número de serie (días
  // desde 1899-12-30); sin esto el número se leía como un año (01-01-46337).
  const ymd = parseFechaYMD(s);
  if (ymd) return ymd;
  if (/^\d{5}$/.test(s.trim())) return new Date(1899, 11, 30 + Number(s));
  const fecha = new Date(s);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/** Fecha de entrega comprometida con el mismo formato (DD-MM-AAAA) que el resto de las fechas. */
function formatFechaEntrega(s: string): string {
  const d = parseFechaEntrega(s);
  if (!d) return s.trim() || "—";
  return d.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Trunca a medianoche local para comparar solo el día, no la hora. */
function soloFecha(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Con fecha de entrega comprometida ya vencida y sin recibir por completo. */
function esAtrasado(p: PedidoResumen): boolean {
  if (!["pendiente", "parcial"].includes(estadoDe(p))) return false;
  const programada = parseFechaEntrega(p.fechaEntrega);
  if (!programada) return false;
  return soloFecha(programada) < soloFecha(new Date());
}

/**
 * Fecha real de entrega del pedido: la más tardía entre las fechas en que
 * cada línea quedó entregada a quien la pidió (campo "Recepcionado por").
 * Solo se considera "conocida" cuando todas las líneas tienen fecha
 * registrada (si falta alguna, es que aún no se le entrega todo al
 * solicitante, o el pedido es anterior a que existiera este campo).
 */
function fechaRecepcionPedido(p: PedidoResumen): Date | null {
  const fechas = p.items
    .filter((it) => !it.anulado)
    .map((it) => parseFechaYMD(it.fechaEntregaSolicitante));
  if (fechas.some((d) => d === null)) return null;
  return new Date(Math.max(...(fechas as Date[]).map((d) => d.getTime())));
}

/** La más tardía entre las fechas de llegada a bodega de las líneas del pedido. */
function fechaBodegaPedido(p: PedidoResumen): Date | null {
  const fechas = p.items
    .filter((it) => !it.anulado)
    .map((it) => parseFechaYMD(it.fechaRecepcionBodega));
  if (fechas.some((d) => d === null)) return null;
  return new Date(Math.max(...(fechas as Date[]).map((d) => d.getTime())));
}

/**
 * ¿Se entregó a tiempo? null cuando aún no está completo o no hay datos
 * suficientes para saberlo (pedidos antiguos sin fecha de recepción).
 */
function entregadoATiempo(p: PedidoResumen): boolean | null {
  if (estadoDe(p) !== "completo") return null;
  const real = fechaRecepcionPedido(p);
  const programada = parseFechaEntrega(p.fechaEntrega);
  if (!real || !programada) return null;
  return soloFecha(real) <= soloFecha(programada);
}

// Estado editable de una línea: strings para poder dejar el input vacío
// mientras se escribe, sin forzar 0.
type LineaEdit = {
  cantidadRecibida: string;
  consumoInterno: string;
  recepcionadoPor: string;
  fechaRecepcionBodega: string;
  fechaEntregaSolicitante: string;
};

function lineaEditDesdeItem(it: PedidoItem): LineaEdit {
  return {
    cantidadRecibida:
      it.cantidadRecibida === null ? "" : String(it.cantidadRecibida),
    consumoInterno: it.consumoInterno,
    recepcionadoPor: it.recepcionadoPor,
    fechaRecepcionBodega: it.fechaRecepcionBodega,
    fechaEntregaSolicitante: it.fechaEntregaSolicitante,
  };
}

/** Fecha de hoy en horario local como "YYYY-MM-DD" (formato de <input type="date">). */
function hoyYMD(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** ¿Lo escrito en la fila difiere de lo que hay guardado en la planilla? */
function tieneCambios(it: PedidoItem, ed: LineaEdit | undefined): boolean {
  if (!ed) return false;
  const base = lineaEditDesdeItem(it);
  return (
    ed.cantidadRecibida.trim() !== base.cantidadRecibida ||
    ed.consumoInterno.trim() !== base.consumoInterno.trim() ||
    ed.recepcionadoPor.trim() !== base.recepcionadoPor.trim() ||
    ed.fechaRecepcionBodega !== base.fechaRecepcionBodega ||
    ed.fechaEntregaSolicitante !== base.fechaEntregaSolicitante
  );
}

/** ¿Dos ediciones de una misma fila tienen exactamente los mismos valores? */
function mismaEdicion(a: LineaEdit, b: LineaEdit): boolean {
  return (
    a.cantidadRecibida === b.cantidadRecibida &&
    a.consumoInterno === b.consumoInterno &&
    a.recepcionadoPor === b.recepcionadoPor &&
    a.fechaRecepcionBodega === b.fechaRecepcionBodega &&
    a.fechaEntregaSolicitante === b.fechaEntregaSolicitante
  );
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export default function GestionPedidosPanel({ pedidoInicial }: { pedidoInicial?: string }) {
  const [noLeidos, refrescarNoLeidos] = useChatNoLeidos();
  const [pedidos, setPedidos] = useState<PedidoResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  // Filtros combinables: los estados suman (pendiente O parcial) y las alertas
  // restringen (urgente Y atrasado). Sin ninguno marcado se ven todos.
  const [estadosSel, setEstadosSel] = useState<Set<Estado>>(
    () => new Set(ESTADOS_POR_ATENDER)
  );
  const [alertasSel, setAlertasSel] = useState<Set<Alerta>>(() => new Set());
  const [orden, setOrden] = useState<"recientes" | "entrega">("recientes");
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [fSolicitante, setFSolicitante] = useState("");
  const [fArea, setFArea] = useState("");
  const [fCentro, setFCentro] = useState("");
  const [fDespacho, setFDespacho] = useState("");
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");

  // Solo las filas que el usuario tocó; el resto se lee de `pedidos`.
  const [ediciones, setEdiciones] = useState<Record<number, LineaEdit>>({});
  const [guardando, setGuardando] = useState<Record<number, boolean>>({});
  const [guardado, setGuardado] = useState<Record<number, boolean>>({});
  const [errores, setErrores] = useState<Record<number, string>>({});
  const [guardandoTodo, setGuardandoTodo] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [horaCarga, setHoraCarga] = useState("");

  // Selección de pedidos completos (casillas de la lista) y de artículos
  // sueltos dentro del pedido abierto. La barra inferior actúa sobre ambos.
  const [selPedidos, setSelPedidos] = useState<Set<string>>(new Set());
  const [seleccionFilas, setSeleccionFilas] = useState<Set<number>>(new Set());
  const ultimoClic = useRef<string | null>(null);

  // Campos de la edición en bloque.
  const [bulkRecepcionadoPor, setBulkRecepcionadoPor] = useState("");
  const [bulkFechaBodega, setBulkFechaBodega] = useState("");
  const [bulkFechaEntrega, setBulkFechaEntrega] = useState("");
  const [bulkConsumo, setBulkConsumo] = useState("");

  // Cierre / anulación / reapertura de un pedido (con diálogo de confirmación).
  const [accion, setAccion] = useState<{
    pedidoIds: string[];
    tipo: "cerrado" | "anulado" | "";
  } | null>(null);
  const [motivoAccion, setMotivoAccion] = useState("");
  const [enviandoEstado, setEnviandoEstado] = useState(false);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);

  // Consumo interno directo a Defontana (diálogo con bodega y artículos).
  const [consumoPedido, setConsumoPedido] = useState<string | null>(null);
  const [avisoConsumo, setAvisoConsumo] = useState<string | null>(null);

  // Eliminar un artículo de un pedido (con diálogo de confirmación).
  const [eliminando, setEliminando] = useState<{
    pedidoId: string;
    fila: number;
    codigo: string;
    nombre: string;
  } | null>(null);
  const [enviandoEliminar, setEnviandoEliminar] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);

  // Anular un artículo (queda en la planilla, marcado, con su motivo).
  const [anulandoLinea, setAnulandoLinea] = useState<{
    pedidoId: string;
    fila: number;
    codigo: string;
    nombre: string;
  } | null>(null);
  const [enviandoAnularLinea, setEnviandoAnularLinea] = useState(false);
  const [errorAnularLinea, setErrorAnularLinea] = useState<string | null>(null);

  // Modificar un pedido ya enviado (corregir artículo/cantidad, agregar, datos).
  const [modificando, setModificando] = useState<
    | { tipo: "linea"; item: PedidoItem }
    | { tipo: "agregar" }
    | { tipo: "cabecera" }
    | null
  >(null);

  const detalleRef = useRef<HTMLElement>(null);
  const ultimaCarga = useRef(0);

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
      ultimaCarga.current = Date.now();
      setHoraCarga(
        new Date().toLocaleTimeString("es-CL", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
      // Deja abierto un pedido para no partir con la pantalla vacía: el que
      // pidió la URL (?pedido=, desde KPIs) si existe; si no, el primer urgente
      // pendiente, y si no el más reciente.
      const pedidoDeUrl =
        inicial && pedidoInicial && lista.some((p) => p.pedidoId === pedidoInicial)
          ? pedidoInicial
          : null;
      setSeleccionado((prev) =>
        pedidoDeUrl ??
        (prev && lista.some((p) => p.pedidoId === prev)
          ? prev
          : ((lista.find(esUrgentePendiente) ?? lista[0])?.pedidoId ?? null))
      );
      if (pedidoDeUrl) {
        window.setTimeout(() => {
          document.getElementById(`pedido-${pedidoDeUrl}`)?.scrollIntoView({ block: "nearest" });
          // En pantallas angostas el detalle queda debajo de la lista.
          if (window.innerWidth < 1024) detalleRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 300);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
      setRefrescando(false);
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => void cargarPedidos(true), 0);
    return () => window.clearTimeout(t);
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

  // Al volver a la pestaña (pasado un minuto) se actualiza la lista sola, para
  // ver los pedidos nuevos sin apretar «Actualizar». No si hay cambios sin
  // guardar, para no mover el piso mientras se trabaja.
  const refrescarAlVolver = useRef<() => void>(() => {});
  useEffect(() => {
    refrescarAlVolver.current = () => {
      if (
        document.visibilityState === "visible" &&
        totalCambios === 0 &&
        Date.now() - ultimaCarga.current > 60_000
      ) {
        void cargarPedidos();
      }
    };
  });
  useEffect(() => {
    const f = () => refrescarAlVolver.current();
    document.addEventListener("visibilitychange", f);
    window.addEventListener("focus", f);
    return () => {
      document.removeEventListener("visibilitychange", f);
      window.removeEventListener("focus", f);
    };
  }, []);

  const conteo = useMemo(() => {
    const c: Record<Filtro, number> = {
      porAtender: 0,
      todos: 0,
      urgentes: 0,
      atrasados: 0,
      pendiente: 0,
      parcial: 0,
      completo: 0,
      cerrado: 0,
      anulado: 0,
    };
    for (const p of pedidos) {
      c[estadoDe(p)] += 1;
      if (["pendiente", "parcial"].includes(estadoDe(p))) c.porAtender += 1;
      if (p.estadoManual !== "anulado") c.todos += 1;
      if (esUrgentePendiente(p)) c.urgentes += 1;
      if (esAtrasado(p)) c.atrasados += 1;
    }
    return c;
  }, [pedidos]);

  // KPI: de los pedidos completos con fecha de recepción conocida, cuántos
  // llegaron a tiempo respecto a la fecha de entrega comprometida.
  const kpiATiempo = useMemo(() => {
    let conDatos = 0;
    let aTiempo = 0;
    for (const p of pedidos) {
      const resultado = entregadoATiempo(p);
      if (resultado === null) continue;
      conDatos += 1;
      if (resultado) aTiempo += 1;
    }
    return {
      conDatos,
      aTiempo,
      porcentaje: conDatos ? Math.round((aTiempo / conDatos) * 100) : null,
    };
  }, [pedidos]);

  // Opciones de los desplegables: valores distintos presentes en los pedidos.
  const opciones = useMemo(() => {
    const unicos = (f: (p: PedidoResumen) => string) =>
      Array.from(new Set(pedidos.map((p) => f(p).trim()).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b, "es")
      );
    return {
      solicitante: unicos((p) => p.solicitante),
      area: unicos((p) => p.area),
      centro: unicos((p) => p.centroNegocio),
      despacho: unicos((p) => p.despacho),
    };
  }, [pedidos]);

  const nFiltrosExtra = [
    fSolicitante,
    fArea,
    fCentro,
    fDespacho,
    fDesde,
    fHasta,
  ].filter(Boolean).length;

  /** Cambia de pestaña y deja abierto el primer pedido de la nueva lista. */
  function aplicarSeleccion(estados: Set<Estado>, alertas: Set<Alerta>) {
    setEstadosSel(estados);
    setAlertasSel(alertas);
    setSeleccionado(null);
    setSeleccionFilas(new Set());
  }

  function cambiarFiltro(f: Filtro) {
    if (f === "porAtender") {
      aplicarSeleccion(new Set(ESTADOS_POR_ATENDER), new Set());
    } else if (f === "todos") {
      aplicarSeleccion(new Set(), new Set());
    } else if (f === "urgentes" || f === "atrasados") {
      const alertas = new Set(alertasSel);
      if (!alertas.delete(f)) alertas.add(f);
      aplicarSeleccion(estadosSel, alertas);
    } else {
      const estados = new Set(estadosSel);
      if (!estados.delete(f)) estados.add(f);
      aplicarSeleccion(estados, alertasSel);
    }
  }

  const vistaPorAtender =
    alertasSel.size === 0 &&
    estadosSel.size === ESTADOS_POR_ATENDER.length &&
    ESTADOS_POR_ATENDER.every((e) => estadosSel.has(e));

  function limpiarFiltros() {
    cambiarFiltro("porAtender");
    setBusqueda("");
    setFSolicitante("");
    setFArea("");
    setFCentro("");
    setFDespacho("");
    setFDesde("");
    setFHasta("");
  }

  // Búsqueda y filtros adicionales (todo salvo estado y alertas).
  const pasaBase = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return (p: PedidoResumen): boolean => {
      if (fSolicitante && p.solicitante.trim() !== fSolicitante) return false;
      if (fArea && p.area.trim() !== fArea) return false;
      if (fCentro && p.centroNegocio.trim() !== fCentro) return false;
      if (fDespacho && p.despacho.trim() !== fDespacho) return false;
      if (fDesde || fHasta) {
        const dia = /^\d{4}-\d{2}-\d{2}/.test(p.fecha)
          ? p.fecha.slice(0, 10)
          : "";
        if (!dia) return false;
        if (fDesde && dia < fDesde) return false;
        if (fHasta && dia > fHasta) return false;
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
    };
  }, [busqueda, fSolicitante, fArea, fCentro, fDespacho, fDesde, fHasta]);

  /** ¿Cumple el estado marcado? Sin estados marcados, todos menos anulados. */
  function pasaEstado(p: PedidoResumen): boolean {
    return estadosSel.size > 0
      ? estadosSel.has(estadoDe(p))
      : p.estadoManual !== "anulado";
  }

  // Números de los chips: cuántos pedidos habría al marcar ese chip con el
  // resto de la selección, la búsqueda y los filtros adicionales vigentes.
  const conteoVista = useMemo(() => {
    const c: Record<Filtro, number> = {
      porAtender: 0,
      todos: 0,
      urgentes: 0,
      atrasados: 0,
      pendiente: 0,
      parcial: 0,
      completo: 0,
      cerrado: 0,
      anulado: 0,
    };
    for (const p of pedidos) {
      if (!pasaBase(p)) continue;
      const estado = estadoDe(p);
      const urgente = esUrgentePendiente(p);
      const atrasado = esAtrasado(p);
      const okUrgente = !alertasSel.has("urgentes") || urgente;
      const okAtrasado = !alertasSel.has("atrasados") || atrasado;
      if (okUrgente && okAtrasado) {
        c[estado] += 1;
        if (ESTADOS_POR_ATENDER.includes(estado)) c.porAtender += 1;
        if (estado !== "anulado") c.todos += 1;
      }
      const okEstado = estadosSel.size > 0 ? estadosSel.has(estado) : estado !== "anulado";
      if (okEstado && okAtrasado && urgente) c.urgentes += 1;
      if (okEstado && okUrgente && atrasado) c.atrasados += 1;
    }
    return c;
  }, [pedidos, pasaBase, estadosSel, alertasSel]);

  const pedidosFiltrados = useMemo(() => {
    return (
      pedidos
        .filter((p) => {
          if (!pasaBase(p)) return false;
          // El pedido abierto se queda en la lista aunque, al guardarlo, deje de
          // cumplir el filtro (p. ej. un pendiente que pasa a completo): así no
          // desaparece de golpe mientras se trabaja en él.
          if (p.pedidoId === seleccionado) return true;
          if (!pasaEstado(p)) return false;
          if (alertasSel.has("urgentes") && !esUrgentePendiente(p)) return false;
          if (alertasSel.has("atrasados") && !esAtrasado(p)) return false;
          return true;
        })
        // Los urgentes pendientes van primero (el orden sigue siendo por fecha,
        // del más reciente al más antiguo, dentro de cada grupo).
        .sort((a, b) => {
          if (orden === "entrega") {
            // Lo que aún falta atender primero; dentro de eso, la entrega más
            // próxima (los vencidos quedan arriba) y sin fecha al final.
            const aAtender = ESTADOS_POR_ATENDER.includes(estadoDe(a));
            const bAtender = ESTADOS_POR_ATENDER.includes(estadoDe(b));
            if (aAtender !== bAtender) return aAtender ? -1 : 1;
            const fa = parseFechaEntrega(a.fechaEntrega);
            const fb = parseFechaEntrega(b.fechaEntrega);
            if (fa && fb) {
              const dif = soloFecha(fa) - soloFecha(fb);
              if (dif !== 0) return dif;
            } else if (fa || fb) {
              return fa ? -1 : 1;
            }
          }
          return Number(esUrgentePendiente(b)) - Number(esUrgentePendiente(a));
        })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidos, pasaBase, estadosSel, alertasSel, seleccionado, orden]);

  // Pedido abierto: el elegido si sigue en la lista; si no, el primero de ella.
  const idActual = pedidosFiltrados.some((p) => p.pedidoId === seleccionado)
    ? seleccionado
    : (pedidosFiltrados[0]?.pedidoId ?? null);

  const pedidoActual = useMemo(
    () => pedidos.find((p) => p.pedidoId === idActual) ?? null,
    [pedidos, idActual]
  );

  const indiceActual = pedidoActual
    ? pedidosFiltrados.findIndex((p) => p.pedidoId === pedidoActual.pedidoId)
    : -1;

  // Pedidos marcados que siguen visibles con el filtro actual.
  const pedidosMarcados = useMemo(
    () => pedidosFiltrados.filter((p) => selPedidos.has(p.pedidoId)),
    [pedidosFiltrados, selPedidos]
  );

  // Marcados que se pueden cerrar en bloque: completos, sin cierre manual y
  // sin cambios sin guardar.
  const pedidosCerrables = useMemo(
    () =>
      pedidosMarcados.filter(
        (p) =>
          !p.estadoManual &&
          estadoPedido(p.items) === "completo" &&
          !cambiosPorPedido.has(p.pedidoId)
      ),
    [pedidosMarcados, cambiosPorPedido]
  );

  // Artículos sobre los que actúa la barra de edición en bloque: todos los de
  // los pedidos marcados + los artículos marcados en el pedido abierto.
  const objetivo = useMemo(() => {
    const m = new Map<number, PedidoItem>();
    for (const p of pedidosMarcados) {
      if (p.estadoManual) continue;
      for (const it of p.items) if (!it.anulado) m.set(it.fila, it);
    }
    if (pedidoActual && !pedidoActual.estadoManual) {
      for (const it of pedidoActual.items) {
        if (!it.anulado && seleccionFilas.has(it.fila)) m.set(it.fila, it);
      }
    }
    return Array.from(m.values());
  }, [pedidosMarcados, pedidoActual, seleccionFilas]);

  function abrirPedido(p: PedidoResumen) {
    setSeleccionado(p.pedidoId);
    setSeleccionFilas(new Set());
    // En pantallas angostas el detalle queda debajo de la lista.
    if (window.innerWidth < 1024) {
      window.setTimeout(
        () => detalleRef.current?.scrollIntoView({ behavior: "smooth" }),
        0
      );
    }
  }

  function irAPedido(delta: number) {
    if (pedidosFiltrados.length === 0) return;
    const base = indiceActual === -1 ? (delta > 0 ? -1 : 0) : indiceActual;
    const destino = Math.min(
      pedidosFiltrados.length - 1,
      Math.max(0, base + delta)
    );
    const p = pedidosFiltrados[destino];
    if (p && p.pedidoId !== idActual) {
      setSeleccionado(p.pedidoId);
      setSeleccionFilas(new Set());
      document
        .getElementById(`pedido-${p.pedidoId}`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }

  function alternarPedido(id: string, rango: boolean) {
    setSelPedidos((prev) => {
      const next = new Set(prev);
      const ids = pedidosFiltrados.map((p) => p.pedidoId);
      const desde = ultimoClic.current ? ids.indexOf(ultimoClic.current) : -1;
      const hasta = ids.indexOf(id);
      const marcar = !prev.has(id);
      if (rango && desde !== -1 && hasta !== -1) {
        const [a, b] = desde < hasta ? [desde, hasta] : [hasta, desde];
        for (const x of ids.slice(a, b + 1)) {
          if (marcar) next.add(x);
          else next.delete(x);
        }
      } else if (marcar) next.add(id);
      else next.delete(id);
      return next;
    });
    ultimoClic.current = id;
  }

  const todosMarcados =
    pedidosFiltrados.length > 0 &&
    pedidosFiltrados.every((p) => selPedidos.has(p.pedidoId));

  function alternarTodosLosPedidos() {
    setSelPedidos((prev) => {
      const next = new Set(prev);
      if (pedidosFiltrados.every((p) => prev.has(p.pedidoId))) {
        for (const p of pedidosFiltrados) next.delete(p.pedidoId);
      } else {
        for (const p of pedidosFiltrados) next.add(p.pedidoId);
      }
      return next;
    });
  }

  function alternarFila(fila: number) {
    setSeleccionFilas((prev) => {
      const next = new Set(prev);
      if (next.has(fila)) next.delete(fila);
      else next.add(fila);
      return next;
    });
  }

  function alternarTodasLasFilas(items: PedidoItem[]) {
    setSeleccionFilas((prev) =>
      items.every((it) => prev.has(it.fila))
        ? new Set()
        : new Set(items.map((it) => it.fila))
    );
  }

  function limpiarSeleccion() {
    setSelPedidos(new Set());
    setSeleccionFilas(new Set());
  }

  function cambiarCampo(
    it: PedidoItem,
    campo: keyof LineaEdit,
    valor: string
  ) {
    setEdiciones((prev) => {
      const base = prev[it.fila] ?? lineaEditDesdeItem(it);
      const next: LineaEdit = { ...base, [campo]: valor };
      // Comodidad: al marcar por primera vez cantidad recibida o quién
      // recepcionó, se propone la fecha de hoy en el campo de fecha
      // correspondiente (si estaba vacío). Sigue siendo editable a mano.
      if (campo === "cantidadRecibida" && valor.trim() !== "" && !base.fechaRecepcionBodega) {
        next.fechaRecepcionBodega = hoyYMD();
      }
      if (campo === "recepcionadoPor" && valor.trim() !== "" && !base.fechaEntregaSolicitante) {
        next.fechaEntregaSolicitante = hoyYMD();
      }
      return { ...prev, [it.fila]: next };
    });
    setGuardado((prev) => ({ ...prev, [it.fila]: false }));
  }

  function marcarRecibido(items: PedidoItem[]) {
    setEdiciones((prev) => {
      const next = { ...prev };
      for (const it of items) {
        const base = prev[it.fila] ?? lineaEditDesdeItem(it);
        next[it.fila] = {
          ...base,
          cantidadRecibida: String(it.cantidad),
          fechaRecepcionBodega: base.fechaRecepcionBodega || hoyYMD(),
        };
      }
      return next;
    });
    setGuardado((prev) => {
      const next = { ...prev };
      for (const it of items) next[it.fila] = false;
      return next;
    });
  }

  /**
   * Rellena en bloque los campos comunes (quién recepcionó, fechas, consumo
   * interno) de varias filas a la vez, para no tipearlos uno a uno. Solo toca
   * los campos con valor; deja vacío = no tocar esa columna.
   */
  function aplicarCamposEnBloque(
    items: PedidoItem[],
    campos: Partial<Omit<LineaEdit, "cantidadRecibida">>
  ) {
    const entradas = Object.entries(campos).filter(
      ([, v]) => v !== undefined && v !== ""
    ) as [keyof LineaEdit, string][];
    if (entradas.length === 0 || items.length === 0) return;
    setEdiciones((prev) => {
      const next = { ...prev };
      for (const it of items) {
        const base = prev[it.fila] ?? lineaEditDesdeItem(it);
        const actualizado: LineaEdit = { ...base };
        for (const [campo, valor] of entradas) actualizado[campo] = valor;
        // Mismo comodín que al editar una fila sola: si se fija quién
        // recepcionó y no había fecha de entrega al solicitante, se propone hoy.
        if (campos.recepcionadoPor && !base.fechaEntregaSolicitante) {
          actualizado.fechaEntregaSolicitante =
            actualizado.fechaEntregaSolicitante || hoyYMD();
        }
        next[it.fila] = actualizado;
      }
      return next;
    });
    setGuardado((prev) => {
      const next = { ...prev };
      for (const it of items) next[it.fila] = false;
      return next;
    });
  }

  function aplicarBulk() {
    aplicarCamposEnBloque(objetivo, {
      recepcionadoPor: bulkRecepcionadoPor.trim(),
      fechaRecepcionBodega: bulkFechaBodega,
      fechaEntregaSolicitante: bulkFechaEntrega,
      consumoInterno: bulkConsumo.trim(),
    });
    setBulkRecepcionadoPor("");
    setBulkFechaBodega("");
    setBulkFechaEntrega("");
    setBulkConsumo("");
  }

  const hayDatosBulk = Boolean(
    bulkRecepcionadoPor.trim() ||
      bulkFechaBodega ||
      bulkFechaEntrega ||
      bulkConsumo.trim()
  );

  /**
   * Guarda todas las filas con cambios de `items` en una sola llamada (la API
   * escribe el lote completo de una vez, en vez de una escritura por fila).
   */
  async function guardarFilas(items: PedidoItem[]): Promise<boolean> {
    const sucias = items.filter((it) => tieneCambios(it, ediciones[it.fila]));
    if (sucias.length === 0) return true;

    const enviadas: Record<number, LineaEdit> = {};
    const lineas: {
      fila: number;
      cantidadRecibida: number | null;
      consumoInterno: string;
      recepcionadoPor: string;
      fechaRecepcionBodega: string;
      fechaEntregaSolicitante: string;
    }[] = [];
    for (const it of sucias) {
      const ed = ediciones[it.fila];
      const cantidadRecibida =
        ed.cantidadRecibida.trim() === "" ? null : Number(ed.cantidadRecibida);
      if (cantidadRecibida !== null && !Number.isFinite(cantidadRecibida)) {
        setErrores((prev) => ({ ...prev, [it.fila]: "Cantidad inválida." }));
        setErrorGuardado(`Revisa la cantidad de «${it.nombre}».`);
        setSeleccionado(
          pedidos.find((p) => p.items.some((x) => x.fila === it.fila))
            ?.pedidoId ?? idActual
        );
        return false;
      }
      enviadas[it.fila] = ed;
      lineas.push({
        fila: it.fila,
        cantidadRecibida,
        consumoInterno: ed.consumoInterno.trim(),
        recepcionadoPor: ed.recepcionadoPor.trim(),
        fechaRecepcionBodega: ed.fechaRecepcionBodega,
        fechaEntregaSolicitante: ed.fechaEntregaSolicitante,
      });
    }

    const filas = lineas.map((l) => l.fila);
    const marcar = (v: boolean) =>
      setGuardando((prev) => {
        const next = { ...prev };
        for (const f of filas) next[f] = v;
        return next;
      });
    marcar(true);
    setErrorGuardado(null);
    setErrores((prev) => {
      const next = { ...prev };
      for (const f of filas) next[f] = "";
      return next;
    });
    try {
      const res = await fetch("/api/pedidos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineas }),
      });
      if (res.status === 401) {
        window.location.reload();
        return false;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar.");

      const porFila = new Map<
        number,
        { fechaRecepcionBodega?: string; fechaEntregaSolicitante?: string }
      >();
      for (const r of (data.resultados ?? []) as {
        fila: number;
        fechaRecepcionBodega?: string;
        fechaEntregaSolicitante?: string;
      }[]) {
        porFila.set(r.fila, r);
      }
      const lineaPorFila = new Map(lineas.map((l) => [l.fila, l]));

      setPedidos((prev) =>
        prev.map((p) => ({
          ...p,
          items: p.items.map((x) => {
            const l = lineaPorFila.get(x.fila);
            if (!l) return x;
            const r = porFila.get(x.fila);
            return {
              ...x,
              cantidadRecibida: l.cantidadRecibida,
              consumoInterno: l.consumoInterno,
              recepcionadoPor: l.recepcionadoPor,
              fechaRecepcionBodega:
                r?.fechaRecepcionBodega ?? l.fechaRecepcionBodega,
              fechaEntregaSolicitante:
                r?.fechaEntregaSolicitante ?? l.fechaEntregaSolicitante,
            };
          }),
        }))
      );
      // Solo se descartan las ediciones que siguen iguales a lo enviado; si
      // alguien siguió escribiendo durante el guardado, eso se conserva.
      setEdiciones((prev) => {
        const next = { ...prev };
        for (const f of filas) {
          if (prev[f] && mismaEdicion(prev[f], enviadas[f])) delete next[f];
        }
        return next;
      });
      setGuardado((prev) => {
        const next = { ...prev };
        for (const f of filas) next[f] = true;
        return next;
      });
      window.setTimeout(
        () =>
          setGuardado((prev) => {
            const next = { ...prev };
            for (const f of filas) next[f] = false;
            return next;
          }),
        2500
      );
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error de red.";
      setErrorGuardado(msg);
      setErrores((prev) => {
        const next = { ...prev };
        for (const f of filas) next[f] = msg;
        return next;
      });
      return false;
    } finally {
      marcar(false);
    }
  }

  function abrirAccion(tipo: "cerrado" | "anulado" | "") {
    if (!pedidoActual) return;
    setAccion({ pedidoIds: [pedidoActual.pedidoId], tipo });
    setMotivoAccion("");
    setErrorEstado(null);
  }

  /** Cierre en bloque de los pedidos marcados que ya están completos. */
  function abrirCierreMasivo() {
    if (pedidosCerrables.length === 0) return;
    setAccion({
      pedidoIds: pedidosCerrables.map((p) => p.pedidoId),
      tipo: "cerrado",
    });
    setMotivoAccion("");
    setErrorEstado(null);
  }

  async function confirmarAccion() {
    if (!accion) return;
    const motivo = motivoAccion.trim();
    if (accion.tipo === "anulado" && !motivo) {
      setErrorEstado("Indica el motivo: quién pidió anularlo y por qué.");
      return;
    }
    setEnviandoEstado(true);
    setErrorEstado(null);
    try {
      const res = await fetch("/api/pedidos/estado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pedidoIds: accion.pedidoIds,
          estado: accion.tipo,
          motivo,
        }),
      });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo actualizar.");
      const afectados = new Set(accion.pedidoIds);
      setPedidos((prev) =>
        prev.map((p) =>
          afectados.has(p.pedidoId)
            ? {
                ...p,
                estadoManual: accion.tipo,
                motivoEstado: accion.tipo === "" ? "" : motivo,
              }
            : p
        )
      );
      setSelPedidos((prev) => {
        const next = new Set(prev);
        for (const id of afectados) next.delete(id);
        return next;
      });
      setSeleccionFilas(new Set());
      setAccion(null);
    } catch (err) {
      setErrorEstado(err instanceof Error ? err.message : "Error de red.");
    } finally {
      setEnviandoEstado(false);
    }
  }

  async function confirmarEliminar() {
    if (!eliminando) return;
    setEnviandoEliminar(true);
    setErrorEliminar(null);
    try {
      const res = await fetch("/api/pedidos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pedidoId: eliminando.pedidoId,
          fila: eliminando.fila,
          codigo: eliminando.codigo,
        }),
      });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo eliminar.");
      // Las filas de abajo suben un lugar: todo lo indexado por fila queda
      // desfasado. Solo se llega aquí sin cambios pendientes, así que se
      // limpia y se recarga la lista desde la planilla.
      setEdiciones({});
      setGuardando({});
      setGuardado({});
      setErrores({});
      setSeleccionFilas(new Set());
      setEliminando(null);
      await cargarPedidos();
    } catch (err) {
      setErrorEliminar(err instanceof Error ? err.message : "Error de red.");
    } finally {
      setEnviandoEliminar(false);
    }
  }

  /** Anula (con `motivo`) o reactiva (sin motivo) un artículo del pedido. */
  async function cambiarAnulacionLinea(
    l: { pedidoId: string; fila: number; codigo: string },
    motivo: string | null
  ): Promise<string | null> {
    try {
      const res = await fetch("/api/pedidos/modificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: motivo === null ? "reactivarLinea" : "anularLinea",
          pedidoId: l.pedidoId,
          fila: l.fila,
          codigoActual: l.codigo,
          motivo: motivo ?? "",
        }),
      });
      if (res.status === 401) {
        window.location.reload();
        return null;
      }
      const data = await res.json();
      if (!res.ok) return data.error || "No se pudo guardar el cambio.";
      await cargarPedidos();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Error de red.";
    }
  }

  async function confirmarAnularLinea(motivo: string) {
    if (!anulandoLinea) return;
    setEnviandoAnularLinea(true);
    setErrorAnularLinea(null);
    const err = await cambiarAnulacionLinea(anulandoLinea, motivo);
    setEnviandoAnularLinea(false);
    if (err) setErrorAnularLinea(err);
    else setAnulandoLinea(null);
  }

  async function guardarTodo() {
    if (guardandoTodo) return;
    setGuardandoTodo(true);
    try {
      await guardarFilas(pedidos.flatMap((p) => p.items));
    } finally {
      setGuardandoTodo(false);
    }
  }

  function descartarTodo() {
    setConfirmandoDescarte(false);
    setEdiciones({});
    setErrores({});
    setErrorGuardado(null);
  }

  // Atajos de teclado: Ctrl+S guarda todo; J/K (o ↓/↑ fuera de un campo)
  // cambian de pedido; X marca/desmarca el pedido abierto para edición en
  // bloque; Esc quita la selección.
  const atajos = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    atajos.current = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (totalCambios > 0) void guardarTodo();
        return;
      }
      const el = e.target as HTMLElement | null;
      const escribiendo =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable);
      if (escribiendo || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        irAPedido(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        irAPedido(-1);
      } else if (e.key === "x" && pedidoActual) {
        alternarPedido(pedidoActual.pedidoId, false);
      } else if (e.key === "Escape") {
        limpiarSeleccion();
      }
    };
  });
  useEffect(() => {
    const f = (e: KeyboardEvent) => atajos.current(e);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-3">
        <span className="sr-only">Cargando pedidos…</span>
        <div className="h-12 animate-pulse rounded-xl border border-border bg-muted/50" />
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

  // Tres grupos: vistas generales, alertas (se cruzan con los estados) y estados.
  const filtros = [
    { key: "porAtender", grupo: 0, label: "Por atender", tono: "bg-accent", ayuda: "Pendientes y parciales: lo que falta recibir o entregar. Desmarca todo para ver todos los pedidos" },
    { key: "urgentes", grupo: 1, label: "Urgentes", tono: "bg-destructive", ayuda: "Urgentes que aún no se reciben por completo" },
    { key: "atrasados", grupo: 1, label: "Atrasados", tono: "bg-destructive/60", ayuda: "Con fecha de entrega vencida y sin completar" },
    { key: "pendiente", grupo: 2, label: "Pendientes", tono: ESTADOS.pendiente.dot, ayuda: "Nada recibido todavía" },
    { key: "parcial", grupo: 2, label: "Parciales", tono: ESTADOS.parcial.dot, ayuda: "Recibidos solo en parte" },
    { key: "completo", grupo: 2, label: "Completos", tono: ESTADOS.completo.dot, ayuda: "Recibidos por completo" },
    { key: "cerrado", grupo: 2, label: "Cerrados", tono: ESTADOS.cerrado.dot, ayuda: "Dados por terminados" },
    { key: "anulado", grupo: 2, label: "Anulados", tono: ESTADOS.anulado.dot, ayuda: "Enviados por error" },
  ].filter(
    (f) =>
      (f.key !== "cerrado" && f.key !== "anulado") ||
      conteo[f.key] > 0 ||
      estadosSel.has(f.key as Estado)
  ) as { key: Filtro; grupo: number; label: string; tono: string; ayuda: string }[];

  const hayBarra = objetivo.length > 0 || totalCambios > 0;
  const objetivoPendientes = objetivo.filter(
    (it) => estadoLinea(it) !== "completo"
  );

  return (
    <div className="space-y-3">
      {/* Barra superior: estado (filtro rápido) + búsqueda + filtros + KPI */}
      <div className={`${cardClass} flex flex-wrap items-center gap-x-3 gap-y-2 p-2`}>
        <div
          role="group"
          aria-label="Filtrar por estado"
          className="flex flex-wrap items-center gap-1"
        >
          {filtros.map((f, i) => {
            const activo =
              f.key === "porAtender"
                ? vistaPorAtender
                : f.key === "urgentes" || f.key === "atrasados"
                  ? alertasSel.has(f.key)
                  : estadosSel.has(f.key as Estado);
            const nuevoGrupo = i > 0 && filtros[i - 1].grupo !== f.grupo;
            // «Urgentes» y «Atrasados» se marcan en rojo cuando hay alguno.
            const alerta =
              (f.key === "urgentes" || f.key === "atrasados") &&
              conteoVista[f.key] > 0;
            return (
              <Fragment key={f.key}>
                {nuevoGrupo && (
                  <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
                )}
              <button
                type="button"
                aria-pressed={activo}
                title={f.ayuda}
                onClick={() => cambiarFiltro(f.key)}
                className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors ${
                  activo
                    ? alerta
                      ? "bg-destructive text-destructive-foreground"
                      : "bg-primary text-primary-foreground"
                    : alerta
                      ? "text-destructive hover:bg-destructive/10"
                      : "text-secondary hover:bg-muted"
                }`}
              >
                <span
                  aria-hidden
                  className={`h-2 w-2 rounded-full ${activo ? "bg-current" : f.tono}`}
                />
                {f.label}
                <span
                  className={`rounded-md px-1.5 text-xs font-bold tabular-nums ${
                    activo ? "bg-white/20" : "bg-muted text-primary"
                  }`}
                >
                  {conteoVista[f.key]}
                </span>
              </button>
              </Fragment>
            );
          })}
        </div>

        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
          {kpiATiempo.conDatos > 0 && (
            <span
              title={`${kpiATiempo.aTiempo}/${kpiATiempo.conDatos} pedidos completos entregados a tiempo`}
              className="hidden items-center gap-1.5 whitespace-nowrap rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground xl:inline-flex"
            >
              A tiempo
              <b
                className={`text-sm tabular-nums ${
                  kpiATiempo.porcentaje !== null && kpiATiempo.porcentaje < 80
                    ? "text-warning"
                    : "text-success"
                }`}
              >
                {kpiATiempo.porcentaje}%
              </b>
            </span>
          )}
          <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              <IconSearch />
            </span>
            <input
              type="search"
              aria-label="Buscar pedidos"
              className={`${fieldClass} pl-9`}
              placeholder="Buscar folio, solicitante, artículo…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <button
            type="button"
            aria-expanded={filtrosAbiertos}
            onClick={() => setFiltrosAbiertos((v) => !v)}
            className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-semibold shadow-sm transition-colors hover:bg-muted ${
              filtrosAbiertos || nFiltrosExtra > 0
                ? "border-accent bg-accent/5 text-accent"
                : "border-border bg-card text-primary"
            }`}
          >
            <IconFilter />
            Filtros
            {nFiltrosExtra > 0 && (
              <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-foreground">
                {nFiltrosExtra}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => cargarPedidos()}
            disabled={refrescando}
            aria-label="Actualizar pedidos"
            title="Actualizar"
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted disabled:opacity-60"
          >
            <span className={refrescando ? "animate-spin" : ""}>
              <IconRefresh />
            </span>
            <span className="hidden 2xl:inline">
              {refrescando
                ? "Actualizando"
                : horaCarga
                  ? `Actualizado ${horaCarga}`
                  : "Actualizar"}
            </span>
          </button>
        </div>
      </div>

      {/* Filtros adicionales (plegables) */}
      {(filtrosAbiertos || nFiltrosExtra > 0) && (
        <div
          role="group"
          aria-label="Filtros adicionales"
          className={`${cardClass} grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(4,minmax(0,1fr))_150px_150px_auto] xl:items-end`}
        >
          {(
            [
              ["Solicitante", fSolicitante, setFSolicitante, opciones.solicitante],
              ["Área", fArea, setFArea, opciones.area],
              ["Centro de negocio", fCentro, setFCentro, opciones.centro],
              ["Despacho", fDespacho, setFDespacho, opciones.despacho],
            ] as const
          ).map(([label, valor, setValor, lista]) => (
            <label key={label} className="block min-w-0">
              <span className={labelClass}>{label}</span>
              {label === "Solicitante" || label === "Centro de negocio" ? (
                <SearchCombobox
                  ariaLabel={label}
                  size="sm"
                  clearable
                  placeholder="Todos"
                  options={lista.map((o) => ({ value: o, label: o }))}
                  value={valor}
                  onChange={setValor}
                />
              ) : (
                <select
                  className={fieldClass}
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                >
                  <option value="">Todos</option>
                  {lista.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              )}
            </label>
          ))}
          <label className="block min-w-0">
            <span className={labelClass}>Pedido desde</span>
            <input
              type="date"
              className={fieldClass}
              value={fDesde}
              max={fHasta || undefined}
              onChange={(e) => setFDesde(e.target.value)}
            />
          </label>
          <label className="block min-w-0">
            <span className={labelClass}>Pedido hasta</span>
            <input
              type="date"
              className={fieldClass}
              value={fHasta}
              min={fDesde || undefined}
              onChange={(e) => setFHasta(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={limpiarFiltros}
            disabled={nFiltrosExtra === 0 && vistaPorAtender && !busqueda}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted disabled:opacity-50"
          >
            Limpiar filtros
          </button>
        </div>
      )}

      {loadError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          No se pudo actualizar: {loadError}
        </p>
      )}

      <div className="grid items-start gap-3 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)]">
        {/* Lista de pedidos */}
        <section
          aria-label="Pedidos registrados"
          className={`${cardClass} flex flex-col overflow-hidden lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)]`}
        >
          <div className="flex items-center gap-3 border-b border-border px-3 py-2.5">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-accent"
              aria-label="Marcar todos los pedidos de la lista"
              checked={todosMarcados}
              disabled={pedidosFiltrados.length === 0}
              onChange={alternarTodosLosPedidos}
            />
            <h2 className="text-sm font-bold text-primary">Pedidos</h2>
            <span className="text-xs text-muted-foreground">
              {pedidosFiltrados.length} de{" "}
              {estadosSel.has("anulado")
                ? conteo.todos + conteo.anulado
                : conteo.todos}
            </span>
            <select
              aria-label="Ordenar pedidos"
              title="Ordenar la lista"
              className="ml-auto h-7 max-w-[10.5rem] rounded-md border border-border bg-card px-1.5 text-xs font-semibold text-primary"
              value={orden}
              onChange={(e) => setOrden(e.target.value as "recientes" | "entrega")}
            >
              <option value="recientes">Más recientes</option>
              <option value="entrega">Entrega más próxima</option>
            </select>
            {pedidosMarcados.length > 0 && (
              <button
                type="button"
                onClick={limpiarSeleccion}
                className="text-xs font-semibold text-accent hover:underline"
              >
                {pedidosMarcados.length} marcado
                {pedidosMarcados.length === 1 ? "" : "s"} · quitar
              </button>
            )}
          </div>

          {pedidosFiltrados.length === 0 ? (
            <div className="px-4 py-12 text-center">
              {pedidos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aún no hay pedidos registrados.
                </p>
              ) : vistaPorAtender && !busqueda && nFiltrosExtra === 0 ? (
                <>
                  <p className="text-sm font-bold text-success">
                    ✓ Todo al día
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    No hay pedidos pendientes ni parciales.
                  </p>
                  <button
                    type="button"
                    onClick={() => cambiarFiltro("todos")}
                    className="mt-3 text-sm font-semibold text-accent hover:underline"
                  >
                    Ver todos los pedidos
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Ningún pedido coincide con el filtro.
                  </p>
                  <button
                    type="button"
                    onClick={limpiarFiltros}
                    className="mt-3 text-sm font-semibold text-accent hover:underline"
                  >
                    Limpiar filtros
                  </button>
                </>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border/70 overflow-y-auto">
              {pedidosFiltrados.map((p) => {
                const estado = ESTADOS[estadoDe(p)];
                const activo = p.pedidoId === idActual;
                const marcado = selPedidos.has(p.pedidoId);
                const vigentes = p.items.filter((it) => !it.anulado);
                const totalPedido = vigentes.reduce(
                  (sum, it) => sum + it.cantidad,
                  0
                );
                const totalRecibido = vigentes.reduce(
                  (sum, it) => sum + (it.cantidadRecibida ?? 0),
                  0
                );
                const porcentaje = totalPedido
                  ? Math.min(100, (totalRecibido / totalPedido) * 100)
                  : 0;
                const sinGuardar = cambiosPorPedido.get(p.pedidoId) ?? 0;
                const urgentePend = esUrgentePendiente(p);
                const atrasado = esAtrasado(p);
                return (
                  <li
                    key={p.pedidoId}
                    id={`pedido-${p.pedidoId}`}
                    className={`flex items-stretch border-l-4 transition-colors ${
                      urgentePend
                        ? activo
                          ? "border-l-destructive bg-destructive/10"
                          : "border-l-destructive bg-destructive/5 hover:bg-destructive/10"
                        : activo
                          ? "border-l-accent bg-accent/5"
                          : "border-l-transparent hover:bg-muted/60"
                    } ${marcado ? "ring-1 ring-inset ring-accent/50" : ""}`}
                  >
                    <label className="flex shrink-0 cursor-pointer items-start px-3 pt-3.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-accent"
                        aria-label={`Marcar pedido ${p.pedidoId}`}
                        checked={marcado}
                        onClick={(e) => {
                          // Shift+clic marca un rango de pedidos.
                          e.stopPropagation();
                        }}
                        onChange={(e) =>
                          alternarPedido(
                            p.pedidoId,
                            (e.nativeEvent as MouseEvent).shiftKey === true
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => abrirPedido(p)}
                      aria-current={activo ? "true" : undefined}
                      className="block min-w-0 flex-1 py-2.5 pr-3 text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className={`text-sm font-bold text-primary ${
                              p.estadoManual === "anulado"
                                ? "line-through opacity-60"
                                : ""
                            }`}
                          >
                            <span title={p.pedidoId}>{folioCorto(p.pedidoId)}</span>
                          </span>
                          {p.urgente && (
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${
                                urgentePend
                                  ? "bg-destructive text-destructive-foreground"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              Urgente
                            </span>
                          )}
                          {atrasado && (
                            <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-destructive">
                              Atrasado
                            </span>
                          )}
                          <InsigniaChat cantidad={noLeidos[p.pedidoId] ?? 0} />
                        </span>
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${estado.chip}`}
                        >
                          {estado.label}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-sm text-card-foreground">
                        {p.solicitante || "—"}
                        <span className="text-muted-foreground">
                          {" · "}
                          {p.area || "—"}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                        <span className="min-w-0 truncate">
                          {p.centroNegocio || "—"}
                        </span>
                        {p.fechaEntrega && (
                          <span
                            className={`shrink-0 tabular-nums ${
                              atrasado ? "font-semibold text-destructive" : ""
                            }`}
                          >
                            Entrega {formatFechaEntrega(p.fechaEntrega)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="tabular-nums">
                          {formatFecha(p.fecha)}
                        </span>
                        <span
                          aria-hidden
                          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                        >
                          <span
                            className="block h-full rounded-full bg-success transition-[width]"
                            style={{ width: `${porcentaje}%` }}
                          />
                        </span>
                        <span className="tabular-nums">
                          {totalRecibido}/{totalPedido} unid.
                        </span>
                      </div>
                      {sinGuardar > 0 && (
                        <div className="mt-1 text-xs font-semibold text-warning">
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

          <div className="hidden border-t border-border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground lg:block">
            <Kbd>J</Kbd>/<Kbd>K</Kbd> cambiar pedido · <Kbd>X</Kbd> marcar ·{" "}
            <Kbd>Shift</Kbd>+clic rango · <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd> guardar
          </div>
        </section>

        {/* Detalle */}
        <section
          ref={detalleRef}
          aria-label="Detalle del pedido"
          className={`${cardClass} min-w-0 scroll-mt-24 lg:min-h-[60vh]`}
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
              key={pedidoActual.pedidoId}
              pedido={pedidoActual}
              sinLeer={noLeidos[pedidoActual.pedidoId] ?? 0}
              onActividad={refrescarNoLeidos}
              ediciones={ediciones}
              guardando={guardando}
              guardado={guardado}
              errores={errores}
              guardandoTodo={guardandoTodo}
              empleados={empleados}
              cambios={cambiosPorPedido.get(pedidoActual.pedidoId) ?? 0}
              seleccionFilas={seleccionFilas}
              posicion={indiceActual}
              total={pedidosFiltrados.length}
              onAnterior={() => irAPedido(-1)}
              onSiguiente={() => irAPedido(1)}
              onCambiar={cambiarCampo}
              onMarcarRecibido={marcarRecibido}
              onGuardarLinea={(it) => guardarFilas([it])}
              onGuardarPedido={() =>
                void (async () => {
                  setGuardandoTodo(true);
                  try {
                    await guardarFilas(pedidoActual.items);
                  } finally {
                    setGuardandoTodo(false);
                  }
                })()
              }
              onAlternarFila={alternarFila}
              onAlternarTodasLasFilas={alternarTodasLasFilas}
              onAccion={abrirAccion}
              onConsumo={() => setConsumoPedido(pedidoActual.pedidoId)}
              onOcAsociada={(filas, oc, articulosCreados) => {
                const set = new Set(filas);
                const nuevos = new Map((articulosCreados ?? []).map((a) => [a.fila, a]));
                setPedidos((prev) =>
                  prev.map((p) =>
                    p.pedidoId !== pedidoActual.pedidoId
                      ? p
                      : {
                          ...p,
                          items: p.items.map((x) => {
                            if (!set.has(x.fila)) return x;
                            const n = nuevos.get(x.fila);
                            return n
                              ? { ...x, ocAsociada: oc, codigo: n.codigo, categoria: n.categoria }
                              : { ...x, ocAsociada: oc };
                          }),
                        }
                  )
                );
                setSeleccionFilas(new Set());
              }}
              onAplicarATodos={aplicarCamposEnBloque}
              hayCambiosPendientes={totalCambios > 0}
              onModificar={setModificando}
              onEliminar={(it) => {
                setErrorEliminar(null);
                setEliminando({
                  pedidoId: pedidoActual.pedidoId,
                  fila: it.fila,
                  codigo: it.codigo,
                  nombre: it.nombre,
                });
              }}
              onAnularLinea={(it) => {
                setErrorAnularLinea(null);
                setAnulandoLinea({
                  pedidoId: pedidoActual.pedidoId,
                  fila: it.fila,
                  codigo: it.codigo,
                  nombre: it.nombre,
                });
              }}
              onReactivarLinea={async (it) => {
                const err = await cambiarAnulacionLinea(
                  { pedidoId: pedidoActual.pedidoId, fila: it.fila, codigo: it.codigo },
                  null
                );
                if (err) setErrores((prev) => ({ ...prev, [it.fila]: err }));
              }}
            />
          )}
        </section>
      </div>

      {modificando && pedidoActual && (
        <DialogoModificar
          pedido={pedidoActual}
          modo={modificando}
          onCerrar={() => setModificando(null)}
          onGuardado={async (nuevoId) => {
            setModificando(null);
            if (nuevoId) setSeleccionado(nuevoId);
            await cargarPedidos();
          }}
        />
      )}

      {eliminando && (
        <DialogoEliminar
          nombre={eliminando.nombre}
          pedidoId={eliminando.pedidoId}
          error={errorEliminar}
          enviando={enviandoEliminar}
          onCancelar={() => setEliminando(null)}
          onConfirmar={() => void confirmarEliminar()}
        />
      )}

      {anulandoLinea && (
        <DialogoAnularLinea
          nombre={anulandoLinea.nombre}
          pedidoId={anulandoLinea.pedidoId}
          error={errorAnularLinea}
          enviando={enviandoAnularLinea}
          onCancelar={() => setAnulandoLinea(null)}
          onConfirmar={(motivo) => void confirmarAnularLinea(motivo)}
        />
      )}

      {consumoPedido &&
        (() => {
          const ped = pedidos.find((p) => p.pedidoId === consumoPedido);
          if (!ped) return null;
          return (
            <DialogoConsumo
              pedido={ped}
              onCerrar={() => setConsumoPedido(null)}
              onRegistrado={(res, ambiente, lineas) => {
                const porFila = new Map(
                  lineas.map((l) => [l.fila, l.consumoInterno])
                );
                setPedidos((prev) =>
                  prev.map((p) =>
                    p.pedidoId !== ped.pedidoId
                      ? p
                      : {
                          ...p,
                          items: p.items.map((x) =>
                            porFila.has(x.fila)
                              ? {
                                  ...x,
                                  consumoInterno:
                                    porFila.get(x.fila) ?? x.consumoInterno,
                                }
                              : x
                          ),
                        }
                  )
                );
                setConsumoPedido(null);
                setAvisoConsumo(
                  `${[
                    res.folioRecepcion
                      ? `OC recepcionada (recepción ${res.folioRecepcion}${
                          res.partes?.length ? `, PE ${res.partes.join(", ")}` : ""
                        })`
                      : "",
                    res.folioEntrada ? `Parte de entrada PECD-${res.folioEntrada}` : "",
                    res.folioConsumo ? `Consumo interno CI-${res.folioConsumo}` : "",
                  ]
                    .filter(Boolean)
                    .join(" y ")} registrado en Defontana (${ambiente}).${
                    res.serviciosSinConsumo?.length
                      ? ` Sin consumo (servicio): ${res.serviciosSinConsumo.join(", ")}.`
                      : ""
                  }`
                );
                window.setTimeout(() => setAvisoConsumo(null), 8000);
              }}
            />
          );
        })()}

      {avisoConsumo && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg"
        >
          {avisoConsumo}
        </div>
      )}

      {accion && (
        <DialogoEstado
          tipo={accion.tipo}
          completo={pedidos.some(
            (p) =>
              accion.pedidoIds.includes(p.pedidoId) &&
              estadoPedido(p.items) === "completo"
          )}
          pedidoId={accion.pedidoIds[0]}
          cantidad={accion.pedidoIds.length}
          motivo={motivoAccion}
          onMotivo={setMotivoAccion}
          error={errorEstado}
          enviando={enviandoEstado}
          onCancelar={() => setAccion(null)}
          onConfirmar={() => void confirmarAccion()}
        />
      )}

      {/* Espacio para que la barra fija no tape las últimas filas */}
      {hayBarra && <div aria-hidden className="h-44" />}

      {/* Barra fija inferior: edición en bloque + guardado global */}
      {hayBarra && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-3 sm:px-6">
          <div className="pointer-events-auto mx-auto flex max-h-[55dvh] w-full max-w-[1800px] flex-col gap-2 overflow-y-auto">
            {objetivo.length > 0 && (
              <div className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-xl border border-accent/40 bg-card p-3 shadow-lg ring-1 ring-accent/10">
                <div className="mr-1 min-w-[150px]">
                  <p className="text-sm font-extrabold text-accent">
                    {objetivo.length}{" "}
                    {objetivo.length === 1 ? "artículo" : "artículos"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {pedidosMarcados.length > 0
                      ? `${pedidosMarcados.length} pedido${pedidosMarcados.length === 1 ? "" : "s"} marcado${pedidosMarcados.length === 1 ? "" : "s"}`
                      : "marcados en el pedido abierto"}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => marcarRecibido(objetivoPendientes)}
                    disabled={objetivoPendientes.length === 0}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-success px-3 text-sm font-bold text-white shadow-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <IconCheck />
                    Todo recibido
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      aplicarCamposEnBloque(objetivo, {
                        fechaRecepcionBodega: hoyYMD(),
                      })
                    }
                    className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted"
                  >
                    Llegó hoy a bodega
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      aplicarCamposEnBloque(objetivo, {
                        fechaEntregaSolicitante: hoyYMD(),
                      })
                    }
                    className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted"
                  >
                    Entregado hoy
                  </button>
                </div>

                {pedidosCerrables.length > 0 && (
                  <button
                    type="button"
                    onClick={abrirCierreMasivo}
                    title="Finalizar y archivar los pedidos completos marcados"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-success/40 bg-success-surface px-3 text-sm font-bold text-success shadow-sm transition-colors hover:bg-success-surface/60"
                  >
                    <IconCheck />
                    Cerrar {pedidosCerrables.length} completo
                    {pedidosCerrables.length === 1 ? "" : "s"}
                  </button>
                )}

                <span aria-hidden className="hidden h-9 w-px bg-border lg:block" />

                <label className="block w-48">
                  <span className={labelClass}>Recepcionado por</span>
                  <SearchCombobox
                    size="sm"
                    allowCustom
                    clearable
                    ariaLabel="Recepcionado por (en bloque)"
                    placeholder="Buscar persona…"
                    options={empleados}
                    value={bulkRecepcionadoPor}
                    onChange={setBulkRecepcionadoPor}
                  />
                </label>
                <label className="block w-36">
                  <span className={labelClass}>Llegó a bodega</span>
                  <input
                    type="date"
                    className={fieldClass}
                    value={bulkFechaBodega}
                    onChange={(e) => setBulkFechaBodega(e.target.value)}
                  />
                </label>
                <label className="block w-36">
                  <span className={labelClass}>Entregado</span>
                  <input
                    type="date"
                    className={fieldClass}
                    value={bulkFechaEntrega}
                    onChange={(e) => setBulkFechaEntrega(e.target.value)}
                  />
                </label>
                <label className="block w-36">
                  <span className={labelClass}>Consumo interno</span>
                  <input
                    className={fieldClass}
                    value={bulkConsumo}
                    onChange={(e) => setBulkConsumo(e.target.value)}
                    placeholder="Opcional"
                  />
                </label>
                <button
                  type="button"
                  onClick={aplicarBulk}
                  disabled={!hayDatosBulk}
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-accent px-3.5 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Aplicar
                </button>
                <button
                  type="button"
                  onClick={limpiarSeleccion}
                  className="ml-auto inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted"
                >
                  Quitar selección
                </button>
              </div>
            )}

            {totalCambios > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-primary px-4 py-2.5 text-primary-foreground shadow-lg">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand"
                />
                <p className="text-sm font-semibold">
                  {totalCambios}{" "}
                  {totalCambios === 1 ? "cambio" : "cambios"} sin guardar
                  {cambiosPorPedido.size > 1 && (
                    <span className="font-normal opacity-70">
                      {" "}
                      en {cambiosPorPedido.size} pedidos
                    </span>
                  )}
                </p>
                {errorGuardado && (
                  <p role="alert" className="text-sm font-semibold text-brand">
                    {errorGuardado}
                  </p>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {confirmandoDescarte ? (
                    <>
                      <span className="text-sm font-semibold">
                        ¿Descartar {totalCambios}?
                      </span>
                      <button
                        type="button"
                        onClick={descartarTodo}
                        className="inline-flex h-9 items-center rounded-lg bg-destructive px-3 text-sm font-bold text-destructive-foreground"
                      >
                        Sí, descartar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmandoDescarte(false)}
                        className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold opacity-80 hover:opacity-100"
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmandoDescarte(true)}
                      disabled={guardandoTodo}
                      className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold opacity-80 transition-opacity hover:opacity-100 disabled:opacity-40"
                    >
                      Descartar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void guardarTodo()}
                    disabled={guardandoTodo}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-extrabold text-brand-foreground shadow-sm transition-colors hover:bg-brand-hover disabled:opacity-60"
                  >
                    {guardandoTodo ? "Guardando…" : "Guardar todo"}
                    {!guardandoTodo && (
                      <span className="hidden rounded bg-black/10 px-1.5 text-[11px] font-bold sm:inline">
                        Ctrl+S
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DialogoEstado({
  tipo,
  completo,
  pedidoId,
  cantidad,
  motivo,
  onMotivo,
  error,
  enviando,
  onCancelar,
  onConfirmar,
}: {
  tipo: "cerrado" | "anulado" | "";
  completo: boolean;
  pedidoId: string;
  cantidad: number;
  motivo: string;
  onMotivo: (v: string) => void;
  error: string | null;
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const textos = {
    cerrado: {
      titulo:
        cantidad > 1
          ? `Cerrar ${cantidad} pedidos`
          : `Cerrar el pedido ${folioCorto(pedidoId)}`,
      detalle: completo
        ? cantidad > 1
          ? `Los ${cantidad} pedidos ya se recibieron completos. Al cerrarlos quedan finalizados y archivados en «Cerrados», y no se podrán editar hasta reabrirlos.`
          : "El pedido ya se recibió completo. Al cerrarlo queda finalizado y archivado en «Cerrados», y no se podrá editar hasta reabrirlo."
        : "Se da por terminado aunque falten artículos: no llegará nada más. Deja de contarse como pendiente o parcial. Puedes reabrirlo después.",
      boton: cantidad > 1 ? `Cerrar ${cantidad} pedidos` : "Cerrar pedido",
      campo: "Motivo (opcional)",
      placeholder: "Ej.: el proveedor no despachará el resto",
    },
    anulado: {
      titulo: `Anular el pedido ${folioCorto(pedidoId)}`,
      detalle:
        "Úsalo solo para pedidos enviados por error o mal hechos, con la confirmación interna del solicitante. No se borra de la planilla: queda marcado como anulado y puedes reabrirlo si fue un error.",
      boton: "Anular pedido",
      campo: "Motivo (obligatorio)",
      placeholder: "Ej.: el solicitante avisó que lo envió sin querer",
    },
    "": {
      titulo: `Reabrir el pedido ${folioCorto(pedidoId)}`,
      detalle:
        "Vuelve a su estado según lo recibido y se podrá editar de nuevo.",
      boton: "Reabrir pedido",
      campo: "",
      placeholder: "",
    },
  }[tipo];
  const caja = useRef<HTMLDivElement>(null);
  // Sin campo de texto (reabrir) el foco queda en el diálogo, para que Esc funcione.
  useEffect(() => {
    if (tipo === "") caja.current?.focus();
  }, [tipo]);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-primary/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCancelar();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancelar();
      }}
    >
      <div
        ref={caja}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={textos.titulo}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-card p-5 shadow-2xl outline-none"
      >
        <h3 className="text-base font-extrabold text-primary">
          {textos.titulo}
        </h3>
        <p className="mt-1.5 text-sm text-muted-foreground">{textos.detalle}</p>
        {tipo !== "" && (
          <label className="mt-4 block">
            <span className={labelClass}>{textos.campo}</span>
            <textarea
              autoFocus
              rows={3}
              value={motivo}
              onChange={(e) => onMotivo(e.target.value)}
              placeholder={textos.placeholder}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          </label>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            disabled={enviando}
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={enviando}
            className={`inline-flex h-9 items-center rounded-lg px-4 text-sm font-bold shadow-sm disabled:opacity-60 ${
              tipo === "anulado"
                ? "bg-destructive text-destructive-foreground hover:opacity-90"
                : "bg-accent text-accent-foreground hover:bg-accent-hover"
            }`}
          >
            {enviando ? "Guardando…" : textos.boton}
          </button>
        </div>
      </div>
    </div>
  );
}

function DialogoConsumo({
  pedido,
  onCerrar,
  onRegistrado,
}: {
  pedido: PedidoResumen;
  onCerrar: () => void;
  onRegistrado: (
    res: {
      accion: string;
      folioRecepcion?: number;
      partes?: number[];
      folioEntrada?: number;
      folioConsumo?: number;
      serviciosSinConsumo?: string[];
    },
    ambiente: string,
    lineas: { fila: number; consumoInterno: string }[]
  ) => void;
}) {
  type Accion = "rec_ci" | "rec" | "ci" | "pe_cd";
  type EstadoOC =
    | { estado: "cargando" | "inexistente" | "error" }
    | {
        estado: "ok";
        lineas: LineaOC[];
        proveedor: string;
        recibidaEstado: string;
        centroNegocio: string;
        centroNombre: string;
      };
  const caja = useRef<HTMLDivElement>(null);
  const [bodegas, setBodegas] = useState<{ codigo: string; nombre: string }[]>(
    []
  );
  const [ambiente, setAmbiente] = useState("");
  const [bodega, setBodega] = useState("");
  const [oc, setOc] = useState("");
  const [factura, setFactura] = useState("");
  // La OC se elige entre las asociadas al pedido; «otra» permite digitar un N°.
  const [otraOc, setOtraOc] = useState(false);
  const [ocsPedido, setOcsPedido] = useState<Record<string, InfoOC>>({});
  const [accion, setAccion] = useState<Accion>("rec_ci");
  // «Entra stock» por OC (rec*) o por ingreso directo sin OC (pe_cd, con
  // costo escrito a mano); solo "ci" consume stock que ya existía. pe_cd es
  // un paso único (entrada + gasto a la vez, ver nota en el endpoint), no
  // una entrada "suelta" como "rec" sin consumo.
  const conRecepcionOC = accion === "rec_ci" || accion === "rec";
  const conEntradaDirecta = accion === "pe_cd";
  const conRecepcion = conRecepcionOC || conEntradaDirecta;
  const [ocLeida, setOcLeida] = useState<(EstadoOC & { oc: string }) | null>(null);
  // Mientras no llegue la respuesta de la OC escrita, se muestra «cargando».
  const ocInfo: EstadoOC | null = !oc
    ? null
    : ocLeida?.oc === oc
      ? ocLeida
      : { estado: "cargando" };
  const [cargando, setCargando] = useState(true);
  // Stock por bodega { BC14: { AICA0081: 10 } }; null mientras carga.
  const [stock, setStock] = useState<Record<string, Record<string, number>> | null>(
    null
  );
  const [errorStock, setErrorStock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const ocsAsociadas = Array.from(
    new Set(pedido.items.map((i) => i.ocAsociada).filter(Boolean))
  ).sort();
  useEffect(() => {
    if (ocsAsociadas.length === 0) return;
    fetch(`/api/pedidos/oc?pedidoId=${encodeURIComponent(pedido.pedidoId)}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const d = await r.json();
        if (r.ok) setOcsPedido(d.ordenes ?? {});
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recibidos = pedido.items.filter((i) => (i.cantidadRecibida ?? 0) > 0);
  // Tope y valor por defecto: lo recibido menos lo ya recepcionado y/o
  // consumido desde aquí (se puede hacer en partes).
  const tope = (i: (typeof recibidos)[number]) => {
    const rec = i.cantidadRecibida ?? 0;
    const soloEntrada = accion === "rec";
    return Math.min(
      soloEntrada ? Infinity : rec - yaConsumido(i.consumoInterno),
      accion === "ci" ? Infinity : rec - yaRecepcionado(i.consumoInterno)
    );
  };
  // Con una OC elegida solo se ofrecen los artículos asociados a ella (si no
  // hay ninguno asociado, los que no tienen OC) y, si la OC está recepcionada
  // en parte, solo los que aún están pendientes de recepción en ella.
  const ocElegida = oc.trim();
  const hayAsociadosAEsta = recibidos.some((i) => i.ocAsociada === ocElegida);
  const elegibles = recibidos.filter((i) => {
    if (tope(i) <= 0) return false;
    if (ocElegida) {
      if (i.ocAsociada && i.ocAsociada !== ocElegida) return false;
      if (hayAsociadosAEsta && i.ocAsociada !== ocElegida) return false;
    }
    if (conRecepcionOC && ocInfo?.estado === "ok" && ocInfo.recibidaEstado === "I") {
      const l = ocInfo.lineas.find((x) => x.codigo === i.codigo);
      if (l && l.pedida - l.recibida <= 0) return false;
    }
    return true;
  });
  const [cantEditada, setCantEditada] = useState<Record<number, string>>({});
  const cant = (i: (typeof recibidos)[number]) =>
    cantEditada[i.fila] ?? String(tope(i));
  const [costoEditada, setCostoEditada] = useState<Record<number, string>>({});
  const costo = (i: (typeof recibidos)[number]) => costoEditada[i.fila] ?? "";
  const [desmarcadas, setDesmarcadas] = useState<Set<number>>(new Set());
  const marcada = (fila: number) => !desmarcadas.has(fila);
  const seleccion = elegibles.filter((i) => marcada(i.fila));

  useEffect(() => {
    const codigos = Array.from(new Set(recibidos.map((i) => i.codigo)));
    if (codigos.length === 0) return;
    fetch(`/api/defontana/stock?codigos=${encodeURIComponent(codigos.join(","))}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setStock(d.stock ?? {});
      })
      .catch(() => setErrorStock(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!oc) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/defontana/oc?numero=${oc}`, { cache: "no-store", signal: ctl.signal })
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error);
          setOcLeida(
            d.existe
              ? {
                  oc,
                  estado: "ok",
                  lineas: d.lineas ?? [],
                  proveedor: d.proveedor ?? "",
                  recibidaEstado: d.estado ?? "",
                  centroNegocio: d.centroNegocio ?? "",
                  centroNombre: d.centroNombre ?? "",
                }
              : { oc, estado: "inexistente" }
          );
        })
        .catch((e) => {
          if (e?.name !== "AbortError") setOcLeida({ oc, estado: "error" });
        });
    }, 400);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [oc]);

  // Avisos de la OC para los artículos marcados. En pe_cd la OC es solo
  // trazabilidad/autocompletado (no se exige que esté recepcionada ni que
  // cuadren cantidades), así que no corre esta validación.
  const problemasOC =
    ocInfo?.estado === "ok" && !conEntradaDirecta
      ? (conRecepcionOC ? problemasPorRecibir : problemasRecepcion)(
          ocInfo,
          seleccion.map((i) => ({
            codigo: i.codigo,
            nombre: i.nombre,
            cantidad: Number(cant(i)) || 0,
          }))
        )
      : [];
  const ocBloquea =
    (conRecepcionOC && !oc) ||
    (!conEntradaDirecta &&
      !!oc &&
      (ocInfo?.estado === "cargando" ||
        ocInfo?.estado === "inexistente" ||
        problemasOC.length > 0));

  // pe_cd: si se indica una OC válida, autocompleta bodega "PROYECTOS CD" y
  // el costo por línea con el precio de la OC (sin pisar lo ya editado a mano).
  useEffect(() => {
    if (!conEntradaDirecta || ocInfo?.estado !== "ok") return;
    setBodega((prev) => {
      if (prev && prev !== "BODEGACENTRAL") return prev;
      const cd = bodegas.find((b) => /proyectos/i.test(b.nombre));
      return cd ? cd.codigo : prev;
    });
    setCostoEditada((prev) => {
      const next = { ...prev };
      for (const i of elegibles) {
        if (next[i.fila] !== undefined) continue;
        const lOC = ocInfo.lineas.find((l) => l.codigo === i.codigo);
        if (lOC && lOC.pedida > 0) {
          next[i.fila] = String(Math.round((lOC.monto / lOC.pedida) * 100) / 100);
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conEntradaDirecta, ocInfo, bodegas]);

  useEffect(() => {
    caja.current?.focus();
    fetch("/api/defontana/bodegas", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          window.location.reload();
          return;
        }
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "No se pudieron leer las bodegas.");
        const lista: { codigo: string; nombre: string }[] = d.bodegas ?? [];
        setBodegas(lista);
        setAmbiente(d.ambiente ?? "");
        // Bodega habitual de los consumos internos de contabilidad.
        if (lista.some((b) => b.codigo === "BODEGACENTRAL")) {
          setBodega((prev) => prev || "BODEGACENTRAL");
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error de red."))
      .finally(() => setCargando(false));
  }, []);

  async function confirmar() {
    const lineas = seleccion.map((i) => ({
      fila: i.fila,
      cantidad: Number(cant(i)),
      ...(conEntradaDirecta ? { costoUnitario: Number(costo(i)) } : {}),
    }));
    if (!bodega) return setError("Elige la bodega.");
    if (conRecepcionOC && !factura.trim()) {
      return setError("Indica el N° de la factura con que se recepcionan los artículos.");
    }
    if (conRecepcionOC && !oc) return setError("Elige la OC que vas a recepcionar.");
    if (ocBloquea) return setError("Revisa el aviso de la OC antes de continuar.");
    if (lineas.length === 0) return setError("Marca al menos un artículo.");
    for (const l of lineas) {
      const it = seleccion.find((i) => i.fila === l.fila)!;
      if (!(l.cantidad > 0) || l.cantidad > tope(it)) {
        return setError(
          `«${it.nombre}»: la cantidad debe ser mayor que 0 y no superar ${tope(it)}.`
        );
      }
      if (conRecepcionOC && !Number.isInteger(l.cantidad)) {
        return setError(`«${it.nombre}»: la recepción solo acepta cantidades enteras.`);
      }
      if (conEntradaDirecta && !(l.costoUnitario! > 0)) {
        return setError(`«${it.nombre}»: indica el costo unitario (mayor a 0).`);
      }
    }
    // Con recepción el stock sube antes de consumir: solo se valida el consumo suelto.
    const faltantes = (accion === "ci" ? lineas : [])
      .map((l) => ({ l, it: seleccion.find((i) => i.fila === l.fila)! }))
      .filter(({ l, it }) => {
        const disp = stock?.[bodega]?.[it.codigo];
        return disp !== undefined && l.cantidad > disp;
      });
    if (faltantes.length > 0) {
      return setError(
        `Sin stock suficiente en ${bodega}: ` +
          faltantes
            .map(({ l, it }) => `${it.nombre} (pides ${l.cantidad}, hay ${stock?.[bodega]?.[it.codigo]})`)
            .join("; ") +
          ". Cambia de bodega o ajusta la cantidad."
      );
    }
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/pedidos/consumo-interno", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pedidoId: pedido.pedidoId,
          bodega,
          accion,
          oc: oc.trim(),
          factura: factura.trim(),
          lineas,
        }),
      });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "No se pudo registrar.");
      onRegistrado(d, d.ambiente, d.lineas ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setEnviando(false);
    }
  }

  const inputClass =
    "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-primary/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCerrar();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !enviando) onCerrar();
      }}
    >
      <div
        ref={caja}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Recepción de OC y consumo interno en Defontana"
        className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl bg-card p-5 shadow-2xl outline-none"
      >
        <h3 className="text-base font-extrabold text-primary">
          Inventario en Defontana · pedido {folioCorto(pedido.pedidoId)}
        </h3>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Centro de negocio:{" "}
          <strong className="text-card-foreground">
            {pedido.centroCodigo || "(sin código)"}
          </strong>
          .
        </p>
        {ambiente === "pruebas" && (
          <p className="mt-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent">
            Ambiente de PRUEBAS (replapi): no afecta la contabilidad real.
          </p>
        )}
        {ambiente === "produccion" && (
          <p className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-xs font-semibold text-destructive">
            PRODUCCIÓN: esto mueve stock y genera comprobantes contables reales.
          </p>
        )}

        <label className="mt-4 block">
          <span className={labelClass}>¿Qué quieres registrar?</span>
          <select
            value={accion}
            onChange={(e) => {
              setAccion(e.target.value as Accion);
              setError(null);
            }}
            disabled={enviando}
            className={inputClass}
          >
            <option value="rec_ci">Recepcionar OC + consumo interno</option>
            <option value="rec">Solo recepcionar OC (queda en stock)</option>
            <option value="ci">Solo consumo interno (ya hay stock)</option>
            <option value="pe_cd">Parte de entrada (costo directo)</option>
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">
            {accion === "rec_ci" &&
              "Recepciona la OC en Defontana (total o parcial): se crea el parte de entrada ligado a la compra, con proveedor y costo de la OC. Enseguida descuenta lo recibido con un consumo interno imputado al centro."}
            {accion === "rec" &&
              "Recepciona la OC en Defontana (total o parcial). El material queda en stock de la bodega; el consumo lo haces después."}
            {accion === "ci" &&
              "Descuenta stock que ya existe en la bodega e imputa el gasto al centro. La OC es opcional; si la indicas, debe estar recepcionada."}
            {accion === "pe_cd" &&
              "Imputa el gasto directo al centro (con los clasificadores 1 y 2 del pedido), con el costo por artículo (si indicas la OC, se autocompleta con su precio). A diferencia de una recepción de OC, esto no pasa por el stock contable de mercaderías: es un solo paso, no necesita consumo interno después."}
          </span>
        </label>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>
              No. DE FACTURA{conRecepcionOC ? "" : " (opcional)"}
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={factura}
              disabled={enviando}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                setFactura(v);
                if (!v) {
                  setOc("");
                  setOtraOc(false);
                }
              }}
              placeholder="Ej.: 4331"
              className={inputClass}
            />
          </label>
          <div>
            <label htmlFor="consumo-oc" className={labelClass}>
              N° DE OC{conRecepcionOC ? "" : " (opcional)"}
            </label>
            <select
              id="consumo-oc"
              value={otraOc ? "__otra" : oc}
              disabled={enviando || !factura.trim()}
              onChange={(e) => {
                if (e.target.value === "__otra") {
                  setOtraOc(true);
                  setOc("");
                } else {
                  setOtraOc(false);
                  setOc(e.target.value);
                }
                setError(null);
              }}
              className={`${inputClass} disabled:opacity-60`}
            >
              <option value="">
                {factura.trim() ? "Elige la OC de la factura" : "Primero el N° de factura"}
              </option>
              {ocsAsociadas
                .filter((n) => {
                  const info = ocsPedido[n];
                  return (
                    !conRecepcionOC ||
                    !info ||
                    ESTADOS_OC_ASOCIABLES.includes(info.estado)
                  );
                })
                .map((n) => {
                  const info = ocsPedido[n];
                  return (
                    <option key={n} value={n}>
                      OC {n}
                      {info ? ` · ${info.proveedor} · ${info.estado}` : ""}
                    </option>
                  );
                })}
              <option value="__otra">Otra OC (digitar el N°)…</option>
            </select>
            {otraOc && (
              <input
                type="text"
                inputMode="numeric"
                value={oc}
                disabled={enviando || !factura.trim()}
                onChange={(e) => setOc(e.target.value.replace(/\D/g, ""))}
                placeholder="Ej.: 4331"
                aria-label="N° de OC"
                className={`${inputClass} mt-2`}
              />
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Ingresa la factura con que se recepcionan los artículos (física o en PDF):
          la OC se habilita después, para elegir la que indica la factura. Solo
          aparecen OC asociadas a este pedido
          {conRecepcionOC ? ` en estado ${ESTADOS_OC_ASOCIABLES.join(" o ")}` : ""}
          ; si la OC está recepcionada en parte, se muestran solo los artículos
          pendientes de recepción.
          {conEntradaDirecta &&
            " Si indicas también la OC, el parte referencia la OC y la factura queda en la glosa («proveedor FAC-número»); sin OC, la factura es el documento de referencia («Factura Electrónica Compra» + este número)."}
        </p>
        {conEntradaDirecta && (
          <p className="mt-1 text-xs text-muted-foreground">
            Si indicas la OC, se autocompletan bodega y costo por artículo desde ella
            y el parte queda ligado a la OC como una recepción (la OC debe estar
            Aprobada o Parcialmente Recepcionada y los artículos caber en lo pendiente).
          </p>
        )}
        {ocInfo?.estado === "cargando" && (
          <p className="mt-1 text-xs text-muted-foreground">Consultando la OC en Defontana…</p>
        )}
        {ocInfo?.estado === "inexistente" && (
          <p className="mt-1 text-xs font-semibold text-destructive">
            La OC {oc} no existe en Defontana.
          </p>
        )}
        {ocInfo?.estado === "error" && (
          <p className="mt-1 text-xs text-muted-foreground">
            No se pudo consultar la OC; se validará al registrar.
          </p>
        )}
        {ocInfo?.estado === "ok" && (
          <p className="mt-1 text-xs text-muted-foreground">
            OC {oc} · {ocInfo.proveedor || "sin proveedor"}
            {!conEntradaDirecta &&
              ` · ${
                ocInfo.recibidaEstado === "C"
                  ? "recepcionada completa"
                  : ocInfo.recibidaEstado === "I"
                    ? "recepcionada parcial"
                    : "sin recepcionar"
              }`}
          </p>
        )}
        {conEntradaDirecta && ocInfo?.estado === "ok" && ocInfo.centroNegocio && (
          <p className="mt-2 rounded-lg bg-warning-surface px-3 py-2 text-xs font-semibold text-warning">
            El parte de entrada costo directo se imputará al centro de negocio de la OC{" "}
            {oc}: {ocInfo.centroNombre || ocInfo.centroNegocio} ({ocInfo.centroNegocio})
            {ocInfo.centroNegocio !== pedido.centroCodigo &&
              `, distinto del centro del pedido (${pedido.centroNegocio})`}
            .
          </p>
        )}
        {problemasOC.length > 0 && (
          <p role="alert" className="mt-1 text-xs font-semibold text-destructive">
            OC {oc}: {problemasOC.join("; ")}.
            {!conRecepcionOC && ` ${AVISO_RECEPCION}`}
          </p>
        )}

        {ambiente === "pruebas" && conEntradaDirecta && (
          <p className="mt-2 text-xs text-muted-foreground">
            Tipo de documento «PE_CD» (Parte de Entrada Costo Directo): primera
            vez que se usa desde aquí — revisa que el folio quede bien anotado.
          </p>
        )}

        <label className="mt-4 block">
          <span className={labelClass}>
            {accion === "ci" ? "Bodega de origen" : "Bodega"}
          </span>
          <select
            value={bodega}
            onChange={(e) => setBodega(e.target.value)}
            disabled={cargando || enviando}
            className={inputClass}
          >
            <option value="">{cargando ? "Cargando…" : "Elige una bodega"}</option>
            {bodegas.map((b) => {
              const st = stock?.[b.codigo];
              const ok = st
                ? elegibles.filter((i) => (st[i.codigo] ?? 0) >= Number(cant(i) || 0)).length
                : 0;
              return (
                <option key={b.codigo} value={b.codigo}>
                  {b.codigo} · {b.nombre}
                  {st && accion === "ci" ? ` — stock para ${ok} de ${elegibles.length}` : ""}
                </option>
              );
            })}
          </select>
        </label>

        <div className="mt-4">
          <span className={labelClass}>
            {conRecepcionOC
              ? "Artículos recibidos por recepcionar"
              : conEntradaDirecta
                ? "Artículos recibidos por ingresar a bodega"
                : "Artículos (recibidos y sin consumo registrado)"}
          </span>
          {elegibles.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              No hay artículos disponibles: deben tener cantidad recibida que
              aún no se haya{" "}
              {accion === "ci"
                ? "consumido"
                : conEntradaDirecta
                  ? "ingresado"
                  : "recepcionado"}
              .
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
              {elegibles.map((i) => {
                const lOC =
                  ocInfo?.estado === "ok"
                    ? ocInfo.lineas.find((l) => l.codigo === i.codigo)
                    : undefined;
                return (
                  <li key={i.fila} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={marcada(i.fila)}
                      disabled={enviando}
                      onChange={(e) =>
                        setDesmarcadas((prev) => {
                          const n = new Set(prev);
                          if (e.target.checked) n.delete(i.fila);
                          else n.add(i.fila);
                          return n;
                        })
                      }
                      aria-label={`Incluir ${i.nombre}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-card-foreground">
                        {i.nombre}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {i.codigo} · recibido {i.cantidadRecibida} {i.unidad}
                        {conRecepcionOC && lOC && (
                          <span className="font-semibold text-card-foreground">
                            {" · "}en la OC quedan {lOC.pedida - lOC.recibida} por recibir
                            {lOC.servicio ? " (servicio: sin stock)" : ""}
                          </span>
                        )}
                        {conRecepcionOC && ocInfo?.estado === "ok" && !lOC && (
                          <span className="font-semibold text-destructive">
                            {" · "}no está en la OC
                          </span>
                        )}
                        {conEntradaDirecta && lOC && (
                          <span className="text-card-foreground">
                            {" · "}precio OC: ${Math.round((lOC.monto / lOC.pedida) * 100) / 100} c/u
                          </span>
                        )}
                        {!conRecepcion &&
                          bodega &&
                          (() => {
                            if (errorStock) return " · stock no disponible";
                            if (!stock) return " · consultando stock…";
                            const disp = stock[bodega]?.[i.codigo] ?? 0;
                            const falta = disp < Number(cant(i) || 0);
                            return (
                              <span
                                className={`font-semibold ${falta ? "text-destructive" : "text-success"}`}
                              >
                                {" · "}stock en {bodega}: {disp}
                                {falta ? " (insuficiente)" : ""}
                              </span>
                            );
                          })()}
                      </p>
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={conRecepcionOC ? 1 : "any"}
                      value={cant(i)}
                      disabled={enviando || !marcada(i.fila)}
                      onChange={(e) =>
                        setCantEditada((prev) => ({ ...prev, [i.fila]: e.target.value }))
                      }
                      aria-label={`Cantidad de ${i.nombre}`}
                      className="h-9 w-20 rounded-lg border border-border bg-card px-2 text-right text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
                    />
                    {conEntradaDirecta && (
                      <div className="w-24 shrink-0">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={costo(i)}
                          disabled={enviando || !marcada(i.fila)}
                          onChange={(e) =>
                            setCostoEditada((prev) => ({ ...prev, [i.fila]: e.target.value }))
                          }
                          placeholder="Costo c/u"
                          aria-label={`Costo unitario de ${i.nombre}`}
                          className="h-9 w-full rounded-lg border border-border bg-card px-2 text-right text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={enviando}
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={enviando || cargando || elegibles.length === 0 || ocBloquea}
            className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm hover:bg-accent-hover disabled:opacity-60"
          >
            {enviando
              ? "Registrando…"
              : accion === "rec_ci"
                ? "Recepcionar y consumir"
                : accion === "rec"
                  ? "Recepcionar OC"
                  : accion === "pe_cd"
                    ? "Ingresar (gasto directo)"
                    : "Registrar consumo interno"}
          </button>
        </div>
      </div>
    </div>
  );
}

type OCBusqueda = {
  numero: number;
  proveedor: string;
  rut: string;
  fecha: string;
  estado: string;
  total: string;
  otroPedido: string | null;
};

function fechaDMA(ymd: string): string {
  return ymd ? ymd.split("-").reverse().join("/") : "";
}

/**
 * Asocia una OC de Defontana a los artículos marcados del pedido. Reglas de
 * Adquisiciones: un pedido puede tener varias OC, pero una OC solo puede estar
 * asociada a un pedido, y solo si está Aprobada o Parcialmente Recepcionada.
 */
function DialogoAsociarOC({
  pedidoId,
  items,
  onCerrar,
  onGuardado,
}: {
  pedidoId: string;
  items: PedidoItem[];
  onCerrar: () => void;
  onGuardado: (oc: string) => void;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const [proveedor, setProveedor] = useState("");
  const [resultados, setResultados] = useState<OCBusqueda[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [numero, setNumero] = useState("");
  const [info, setInfo] = useState<
    | { numero: string; estado: "cargando" | "inexistente" | "error" }
    | {
        numero: string;
        estado: "ok";
        proveedor: string;
        fecha: string;
        estadoOC: string;
        asociable: boolean;
        otroPedido: string | null;
        codigos: string[];
      }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => caja.current?.focus(), []);

  // Búsqueda por proveedor (nombre o RUT) con retardo mientras se escribe.
  useEffect(() => {
    const texto = proveedor.trim();
    if (texto.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setBuscando(true);
      fetch(
        `/api/pedidos/oc?proveedor=${encodeURIComponent(texto)}&pedidoId=${encodeURIComponent(pedidoId)}`,
        { cache: "no-store", signal: ctl.signal }
      )
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "No se pudo buscar.");
          setResultados(d.ordenes ?? []);
          setError(null);
        })
        .catch((e) => {
          if (e?.name !== "AbortError") {
            setResultados(null);
            setError(e instanceof Error ? e.message : "Error de red.");
          }
        })
        .finally(() => {
          if (!ctl.signal.aborted) setBuscando(false);
        });
    }, 450);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [proveedor, pedidoId]);

  // Datos de la OC elegida (fecha, estado, si se puede asociar).
  useEffect(() => {
    if (!numero) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(
        `/api/pedidos/oc?numero=${numero}&pedidoId=${encodeURIComponent(pedidoId)}`,
        { cache: "no-store", signal: ctl.signal }
      )
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error);
          setInfo(
            d.existe
              ? {
                  numero,
                  estado: "ok",
                  proveedor: d.proveedor ?? "",
                  fecha: d.fecha ?? "",
                  estadoOC: d.estado ?? "",
                  asociable: d.asociable === true,
                  otroPedido: d.otroPedido ?? null,
                  codigos: d.codigos ?? [],
                }
              : { numero, estado: "inexistente" }
          );
        })
        .catch((e) => {
          if (e?.name !== "AbortError") setInfo({ numero, estado: "error" });
        });
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [numero, pedidoId]);

  const infoActual = !numero
    ? null
    : info?.numero === numero
      ? info
      : ({ numero, estado: "cargando" } as const);
  const faltan =
    infoActual?.estado === "ok"
      ? items.filter((i) => !infoActual.codigos.includes(i.codigo))
      : [];
  const yaAsociadas = items.filter((i) => i.ocAsociada);
  const puedeGuardar =
    infoActual?.estado === "ok" &&
    infoActual.asociable &&
    !infoActual.otroPedido &&
    faltan.length === 0 &&
    !enviando;

  async function guardar(oc: string) {
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/pedidos/oc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedidoId, oc, filas: items.map((i) => i.fila) }),
      });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "No se pudo asociar la OC.");
      onGuardado(oc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setEnviando(false);
    }
  }

  const inputClass =
    "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40";
  const grupos = new Map<string, OCBusqueda[]>();
  for (const o of resultados ?? []) {
    const k = `${o.proveedor} (${o.rut})`;
    grupos.set(k, [...(grupos.get(k) ?? []), o]);
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-primary/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCerrar();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !enviando) onCerrar();
      }}
    >
      <div
        ref={caja}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Asociar orden de compra a los artículos seleccionados"
        className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl bg-card p-5 shadow-2xl outline-none"
      >
        <h3 className="text-base font-extrabold uppercase tracking-wide text-primary">
          Asociar orden de compra a los artículos seleccionados del pedido{" "}
          {folioCorto(pedidoId)}
        </h3>
        <ul className="mt-2 max-h-24 overflow-y-auto rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs text-card-foreground">
          {items.map((i) => (
            <li key={i.fila} className="truncate">
              {i.nombre}
              {i.ocAsociada ? (
                <span className="text-muted-foreground"> · hoy en OC {i.ocAsociada}</span>
              ) : null}
            </li>
          ))}
        </ul>

        <label className="mt-4 block">
          <span className={labelClass}>Buscar proveedor</span>
          <input
            type="text"
            value={proveedor}
            disabled={enviando}
            onChange={(e) => {
              setProveedor(e.target.value);
              if (e.target.value.trim().length < 2) setResultados(null);
            }}
            placeholder="Nombre o RUT del proveedor"
            className={inputClass}
          />
        </label>
        {buscando && (
          <p className="mt-1 text-xs text-muted-foreground">Buscando OC en Defontana…</p>
        )}
        {resultados && !buscando && resultados.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Sin OC {ESTADOS_OC_ASOCIABLES.join(" o ")} para «{proveedor.trim()}» en los
            últimos 12 meses.
          </p>
        )}
        {resultados && resultados.length > 0 && (
          <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
            {Array.from(grupos.entries()).map(([prov, ocs]) => (
              <div key={prov}>
                <p className="sticky top-0 bg-muted px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-secondary">
                  {prov}
                </p>
                <ul className="divide-y divide-border">
                  {ocs.map((o) => (
                    <li key={o.numero}>
                      <button
                        type="button"
                        disabled={enviando || !!o.otroPedido}
                        onClick={() => {
                          setNumero(String(o.numero));
                          setError(null);
                        }}
                        className={`flex w-full flex-wrap items-center gap-x-3 px-3 py-1.5 text-left text-sm hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50 ${
                          numero === String(o.numero) ? "bg-accent/10" : ""
                        }`}
                      >
                        <span className="font-bold text-primary">OC {o.numero}</span>
                        <span className="text-xs text-muted-foreground">
                          {fechaDMA(o.fecha)} · {o.estado} · {o.total}
                        </span>
                        {o.otroPedido && (
                          <span className="text-xs font-semibold text-destructive">
                            ya asociada al pedido {o.otroPedido}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <p className="mt-4 text-center text-xs font-bold uppercase tracking-wide text-secondary">
          Asociar orden de compra
        </p>
        <div className="mt-2 grid grid-cols-[5rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
          <label htmlFor="oc-numero" className="font-semibold text-card-foreground">
            Número
          </label>
          <input
            id="oc-numero"
            type="text"
            inputMode="numeric"
            value={numero}
            disabled={enviando}
            onChange={(e) => {
              setNumero(e.target.value.replace(/\D/g, ""));
              setError(null);
            }}
            placeholder="Ej.: 4759"
            className={`${inputClass} max-w-[10rem]`}
          />
          <span className="font-semibold text-card-foreground">Fecha</span>
          <span className="text-card-foreground">
            {infoActual?.estado === "ok" ? fechaDMA(infoActual.fecha) : "—"}
          </span>
          <span className="font-semibold text-card-foreground">Estado</span>
          <span className="text-card-foreground">
            {infoActual?.estado === "ok" ? infoActual.estadoOC : "—"}
          </span>
        </div>
        {infoActual?.estado === "cargando" && (
          <p className="mt-1 text-xs text-muted-foreground">Consultando la OC en Defontana…</p>
        )}
        {infoActual?.estado === "inexistente" && (
          <p role="alert" className="mt-1 text-xs font-semibold text-destructive">
            La OC {numero} no existe en Defontana.
          </p>
        )}
        {infoActual?.estado === "error" && (
          <p role="alert" className="mt-1 text-xs font-semibold text-destructive">
            No se pudo consultar la OC. Reintenta.
          </p>
        )}
        {infoActual?.estado === "ok" && (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              Proveedor: {infoActual.proveedor || "—"}
            </p>
            {!infoActual.asociable && (
              <p role="alert" className="mt-1 text-xs font-semibold text-destructive">
                La OC está «{infoActual.estadoOC}»: solo se asocian OC{" "}
                {ESTADOS_OC_ASOCIABLES.join(" o ")}.
              </p>
            )}
            {infoActual.otroPedido && (
              <p role="alert" className="mt-1 text-xs font-semibold text-destructive">
                La OC ya está asociada al pedido {infoActual.otroPedido}: una OC solo
                puede asociarse a un pedido.
              </p>
            )}
            {faltan.length > 0 && (
              <p role="alert" className="mt-1 text-xs font-semibold text-destructive">
                La OC no incluye: {faltan.map((i) => `«${i.nombre}»`).join(", ")}.
              </p>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {yaAsociadas.length > 0 && (
            <button
              type="button"
              onClick={() => void guardar("")}
              disabled={enviando}
              className="mr-auto inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-50"
            >
              Quitar OC
            </button>
          )}
          <button
            type="button"
            onClick={onCerrar}
            disabled={enviando}
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void guardar(numero)}
            disabled={!puedeGuardar}
            className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm hover:bg-accent-hover disabled:opacity-60"
          >
            {enviando ? "Asociando…" : "Asociar OC"}
          </button>
        </div>
      </div>
    </div>
  );
}

type ProveedorBusqueda = { rut: string; nombre: string; condicionPago: string };
type CondicionBusqueda = { codigo: string; nombre: string };

const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

/**
 * Crea en Defontana una OC con los artículos marcados del pedido. Reutiliza el
 * centro de negocio, los clasificadores y el código del pedido; el proveedor, la
 * condición de pago y los precios se eligen aquí. Al crearse queda asociada a
 * esos artículos (un pedido puede tener varias OC).
 */
function DialogoCrearOC({
  pedido,
  items,
  onCerrar,
  onEditarManual,
  onCreada,
}: {
  pedido: PedidoResumen;
  items: PedidoItem[];
  onCerrar: () => void;
  /** Abre la edición (lápiz) de un artículo manual para crearlo en Defontana. */
  onEditarManual: (item: PedidoItem) => void;
  onCreada: (
    filas: number[],
    oc: string,
    articulosCreados: { fila: number; codigo: string; categoria: string }[]
  ) => void;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<ProveedorBusqueda[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [proveedor, setProveedor] = useState<ProveedorBusqueda | null>(null);
  const [condiciones, setCondiciones] = useState<CondicionBusqueda[]>([]);
  const [ambiente, setAmbiente] = useState("");
  const [condicion, setCondicion] = useState("");
  const [fechaRecepcion, setFechaRecepcion] = useState(
    () => fechaEntregaAYMD(pedido.fechaEntrega) || new Date().toLocaleDateString("en-CA")
  );
  const [exenta, setExenta] = useState(false);
  const [precios, setPrecios] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [creada, setCreada] = useState<{
    oc: number;
    omitidos: string[];
    articulos: { fila: number; codigo: string; categoria: string }[];
  } | null>(null);

  useEffect(() => caja.current?.focus(), []);

  useEffect(() => {
    fetch("/api/pedidos/oc/crear", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setCondiciones(d.condiciones ?? []);
        setAmbiente(d.ambiente ?? "");
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "No se pudieron leer las condiciones de pago.")
      );
  }, []);

  // Búsqueda de proveedor (nombre o RUT) con retardo mientras se escribe.
  useEffect(() => {
    const t = texto.trim();
    if (t.length < 2) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      setBuscando(true);
      fetch(`/api/pedidos/oc/crear?proveedor=${encodeURIComponent(t)}`, {
        cache: "no-store",
        signal: ctl.signal,
      })
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "No se pudo buscar.");
          setResultados(d.proveedores ?? []);
          setError(null);
        })
        .catch((e) => {
          if (e?.name !== "AbortError") {
            setResultados(null);
            setError(e instanceof Error ? e.message : "Error de red.");
          }
        })
        .finally(() => {
          if (!ctl.signal.aborted) setBuscando(false);
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [texto]);

  const num = (fila: number) => Number((precios[fila] ?? "").replace(",", "."));
  const neto = items.reduce((a, i) => a + Math.round(i.cantidad * (num(i.fila) || 0)), 0);
  const iva = exenta ? 0 : Math.round(neto * 0.19);
  const preciosOk = items.every((i) => num(i.fila) > 0);
  // Los artículos manuales deben crearse antes en Defontana (con su categoría).
  const manuales = items.filter((i) => i.codigo === CODIGO_ARTICULO_MANUAL);
  const puedeCrear =
    !!proveedor &&
    !!condicion &&
    !!fechaRecepcion &&
    preciosOk &&
    manuales.length === 0 &&
    !enviando &&
    !creada;
  const condicionProveedor = proveedor
    ? condiciones.find((c) => c.codigo === proveedor.condicionPago)
    : undefined;

  function elegir(p: ProveedorBusqueda) {
    setProveedor(p);
    setResultados(null);
    setTexto("");
    setError(null);
    // La condición que el proveedor trae en Defontana es solo la sugerida.
    if (condiciones.some((c) => c.codigo === p.condicionPago)) setCondicion(p.condicionPago);
  }

  async function crear() {
    if (!proveedor) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/pedidos/oc/crear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pedidoId: pedido.pedidoId,
          proveedor: proveedor.rut,
          condicionPago: condicion,
          fechaRecepcion,
          exenta,
          lineas: items.map((i) => ({
            fila: i.fila,
            precio: num(i.fila),
          })),
        }),
      });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "No se pudo crear la OC.");
      setCreada({
        oc: d.oc,
        omitidos: d.omitidos ?? [],
        articulos: d.articulosCreados ?? [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setEnviando(false);
    }
  }

  const inputClass =
    "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:bg-muted";
  const cerrar = () =>
    creada
      ? onCreada(
          items.map((i) => i.fila),
          String(creada.oc),
          creada.articulos
        )
      : onCerrar();

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-primary/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) cerrar();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !enviando) cerrar();
      }}
    >
      <div
        ref={caja}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Crear orden de compra con los artículos seleccionados"
        className="max-h-[90dvh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-card p-5 shadow-2xl outline-none"
      >
        <h3 className="text-base font-extrabold uppercase tracking-wide text-primary">
          Crear orden de compra · pedido {folioCorto(pedido.pedidoId)}
        </h3>
        {ambiente === "pruebas" && (
          <p className="mt-1 rounded-md bg-muted px-2 py-1 text-xs font-semibold text-secondary">
            Defontana en modo PRUEBAS: la OC no se crea en producción.
          </p>
        )}

        {creada ? (
          <div className="mt-4 space-y-2 text-sm text-card-foreground">
            <p className="font-bold text-primary">OC {creada.oc} creada y asociada al pedido.</p>
            <p>Queda en estado «Ingresado»: falta aprobarla en Defontana.</p>
            {creada.articulos.length > 0 && (
              <p>
                Artículos creados en Defontana:{" "}
                {creada.articulos
                  .map((a) => {
                    const it = items.find((x) => x.fila === a.fila);
                    return `${it?.nombre ?? "artículo"} → ${a.codigo}`;
                  })
                  .join(" · ")}
              </p>
            )}
            {creada.omitidos.length > 0 && (
              <p role="alert" className="font-semibold text-destructive">
                Defontana no permite enviar por API: {creada.omitidos.join(", ")}. Complétalos a
                mano en la OC (pedido: {pedido.clasificador1 || "—"} /{" "}
                {pedido.clasificador2 || "—"}).
              </p>
            )}
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={cerrar}
                className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm hover:bg-accent-hover"
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : manuales.length > 0 ? (
          <div className="mt-4 space-y-3 text-sm text-card-foreground">
            <p role="alert" className="font-semibold text-destructive">
              No se puede crear la OC: hay {manuales.length}{" "}
              {manuales.length === 1 ? "artículo manual" : "artículos manuales"} que aún no
              existen en Defontana. Créalos primero con su categoría.
            </p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {manuales.map((i) => (
                <li key={i.fila} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="font-semibold">{i.nombre}</span>
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      · {i.cantidad} {i.unidad}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onEditarManual(i)}
                    className="inline-flex h-8 shrink-0 items-center rounded-lg bg-accent px-3 text-xs font-bold text-accent-foreground shadow-sm hover:bg-accent-hover"
                  >
                    ✏️ Crear artículo
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              En cada uno: lápiz (✏️) → «+ Crear este artículo en Defontana» → elige la categoría
              (puedes buscar artículos parecidos) y la unidad. Luego vuelve a «Crear OC».
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onCerrar}
                className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-2 text-xs text-muted-foreground">
              Centro de negocio: <b>{pedido.centroNegocio || "—"}</b> · Clasif. 1:{" "}
              <b>{pedido.clasificador1 || "—"}</b> · Clasif. 2:{" "}
              <b>{pedido.clasificador2 || "—"}</b> (del pedido)
            </p>

            <p className={`${labelClass} mt-4`}>Proveedor</p>
            {proveedor ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-semibold text-card-foreground">
                  {proveedor.nombre} <span className="font-normal">({proveedor.rut})</span>
                </span>
                <button
                  type="button"
                  disabled={enviando}
                  onClick={() => setProveedor(null)}
                  className="text-xs font-semibold text-secondary hover:underline"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={texto}
                  disabled={enviando}
                  onChange={(e) => {
                    setTexto(e.target.value);
                    if (e.target.value.trim().length < 2) setResultados(null);
                  }}
                  placeholder="Nombre o RUT completo del proveedor"
                  className={inputClass}
                />
                {buscando && (
                  <p className="mt-1 text-xs text-muted-foreground">Buscando en Defontana…</p>
                )}
                {resultados && !buscando && resultados.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sin proveedores activos para «{texto.trim()}». Si es nuevo, créalo antes en
                    Defontana.
                  </p>
                )}
                {resultados && resultados.length > 0 && (
                  <ul className="mt-2 max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                    {resultados.map((p) => (
                      <li key={p.rut}>
                        <button
                          type="button"
                          onClick={() => elegir(p)}
                          className="flex w-full flex-wrap items-center gap-x-3 px-3 py-1.5 text-left text-sm hover:bg-accent/10"
                        >
                          <span className="font-bold text-primary">{p.nombre}</span>
                          <span className="text-xs text-muted-foreground">
                            {p.rut}
                            {p.condicionPago ? ` · ${p.condicionPago}` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={labelClass}>Condición de pago</span>
                <select
                  className={inputClass}
                  value={condicion}
                  disabled={enviando}
                  onChange={(e) => setCondicion(e.target.value)}
                >
                  <option value="">Selecciona…</option>
                  {condiciones.map((c) => (
                    <option key={c.codigo} value={c.codigo}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
                {proveedor && (
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    Condición del proveedor en Defontana:{" "}
                    {condicionProveedor?.nombre || proveedor.condicionPago || "ninguna"}
                  </span>
                )}
              </label>
              <label className="block">
                <span className={labelClass}>Fecha de recepción</span>
                <input
                  type="date"
                  className={inputClass}
                  value={fechaRecepcion}
                  disabled={enviando}
                  onChange={(e) => setFechaRecepcion(e.target.value)}
                />
              </label>
            </div>

            <p className={`${labelClass} mt-4`}>Artículos y precio neto unitario</p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Artículo</th>
                    <th className="w-24 px-3 py-2 text-right">Cantidad</th>
                    <th className="w-24 px-3 py-2">Unidad</th>
                    <th className="w-40 px-3 py-2 text-right">Precio neto unit.</th>
                    <th className="w-32 px-3 py-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((i) => (
                    <tr key={i.fila}>
                      <td className="px-3 py-2 text-card-foreground">
                        <span className="font-semibold">{i.nombre}</span>
                        <span className="block text-[11px] text-muted-foreground">{i.codigo}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-base font-bold tabular-nums text-primary">
                        {i.cantidad}
                      </td>
                      <td className="px-3 py-2 text-card-foreground">{i.unidad}</td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`Precio neto unitario de ${i.nombre}`}
                          placeholder="Precio"
                          value={precios[i.fila] ?? ""}
                          disabled={enviando}
                          onChange={(e) =>
                            setPrecios((p) => ({
                              ...p,
                              [i.fila]: e.target.value.replace(/[^\d.,]/g, ""),
                            }))
                          }
                          className="h-9 w-full rounded-lg border border-border bg-card px-2 text-right text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-card-foreground">
                        {num(i.fila) > 0 ? clp(i.cantidad * num(i.fila)) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <label className="inline-flex items-center gap-2 text-card-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-accent"
                  checked={exenta}
                  disabled={enviando}
                  onChange={(e) => setExenta(e.target.checked)}
                />
                Exenta de IVA
              </label>
              <span className="text-card-foreground">
                Neto {clp(neto)} · IVA {clp(iva)} · <b>Total {clp(neto + iva)}</b>
              </span>
            </div>

            {error && (
              <p role="alert" className="mt-3 text-sm font-medium text-destructive">
                {error}
              </p>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={onCerrar}
                disabled={enviando}
                className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void crear()}
                disabled={!puedeCrear}
                className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm hover:bg-accent-hover disabled:opacity-60"
              >
                {enviando ? "Creando OC…" : "Crear OC en Defontana"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DialogoModificar({
  pedido,
  modo,
  onCerrar,
  onGuardado,
}: {
  pedido: PedidoResumen;
  modo:
    | { tipo: "linea"; item: PedidoItem }
    | { tipo: "agregar" }
    | { tipo: "cabecera" };
  onCerrar: () => void;
  onGuardado: (nuevoPedidoId?: string) => Promise<void>;
}) {
  const item = modo.tipo === "linea" ? modo.item : null;
  const cabecera = modo.tipo === "cabecera";
  const caja = useRef<HTMLDivElement>(null);
  const [catalogo, setCatalogo] = useState<
    { codigo: string; nombre: string; categoria: string; unidad: string }[]
  >([]);
  const [codigo, setCodigo] = useState(item?.codigo ?? "");
  const [cantidad, setCantidad] = useState(item ? String(item.cantidad) : "");
  const [comentarioArt, setComentarioArt] = useState(item?.comentarioArticulo ?? "");
  // El campo de fecha solo entiende AAAA-MM-DD; la planilla trae «25-11-26».
  const [fechaEntrega, setFechaEntrega] = useState(() => fechaEntregaAYMD(pedido.fechaEntrega));
  const [despacho, setDespacho] = useState(pedido.despacho);
  const [comentario, setComentario] = useState(pedido.comentario);
  const [solicitante, setSolicitante] = useState(pedido.solicitante);
  const [centroCodigo, setCentroCodigo] = useState(pedido.centroCodigo);
  const [area, setArea] = useState(
    AREAS_PEDIDO.find((a) => a.label.toLowerCase() === pedido.area.trim().toLowerCase())?.label ??
      pedido.area
  );
  const [clasificador1, setClasificador1] = useState(pedido.clasificador1);
  const [clasificador2, setClasificador2] = useState(pedido.clasificador2);
  const [urgente, setUrgente] = useState(pedido.urgente);
  const [solicitantes, setSolicitantes] = useState<string[]>([]);
  const [centros, setCentros] = useState<{ codigo: string; descripcion: string }[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si ya hay recepción o consumo registrado, el artículo queda fijo.
  const fijo = Boolean(item && ((item.cantidadRecibida ?? 0) > 0 || item.consumoInterno));

  // Artículo manual: se puede crear en Defontana desde aquí (sin «Crear OC»).
  const esManualItem = item?.codigo === CODIGO_ARTICULO_MANUAL && !fijo;
  const [crearAbierto, setCrearAbierto] = useState(false);
  const [listas, setListas] = useState<{
    categorias: { id: number; nombre: string }[];
    unidades: { codigo: string; nombre: string }[];
  } | null>(null);
  const [nombreNuevo, setNombreNuevo] = useState(item?.nombre ?? "");
  const [catId, setCatId] = useState("");
  const [unidadNueva, setUnidadNueva] = useState(item?.unidad ?? "UN");
  const [busqCat, setBusqCat] = useState(item?.nombre ?? "");
  const [creando, setCreando] = useState(false);

  const sinTildes = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // Artículos del catálogo parecidos a lo buscado, con su categoría, para elegir
  // la categoría de uno que se le parezca.
  // Palabras de un nombre para comparar: sin tildes ni signos, y sin el «UN»/«UNA»
  // inicial que a veces se escribe antes del nombre («UN KIT COLECTOR…»).
  const palabrasDe = (s: string) => {
    const p = sinTildes(s)
      .replace(/[^a-z0-9/.]+/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    return ["un", "una", "uno"].includes(p[0]) && p.length > 1 ? p.slice(1) : p;
  };
  // Artículos que ya existen con (casi) el mismo nombre que el que se va a crear.
  const similares = useMemo(() => {
    const a = palabrasDe(nombreNuevo);
    if (a.length === 0) return [];
    const conjA = new Set(a);
    return catalogo
      .map((c) => {
        const b = palabrasDe(c.nombre);
        const comunes = b.filter((p) => conjA.has(p)).length;
        const union = new Set([...a, ...b]).size;
        return { c, exacto: a.join(" ") === b.join(" "), score: union ? comunes / union : 0 };
      })
      .filter((x) => x.exacto || x.score >= 0.75)
      .sort((x, y) => Number(y.exacto) - Number(x.exacto) || y.score - x.score)
      .slice(0, 4);
  }, [nombreNuevo, catalogo]);
  const hayExacto = similares.some((x) => x.exacto);

  const parecidos = useMemo(() => {
    const palabras = palabrasDe(busqCat).filter((p) => p.length > 1);
    if (palabras.length === 0) return [];
    return catalogo
      .filter((a) => {
        const n = sinTildes(a.nombre);
        return palabras.every((p) => n.includes(p));
      })
      .slice(0, 12);
  }, [busqCat, catalogo]);

  function abrirCrear() {
    setCrearAbierto(true);
    if (listas) return;
    fetch("/api/pedidos/oc/crear")
      .then((r) => r.json())
      .then((d) => {
        if (!d.categorias) throw new Error(d.error);
        setListas({ categorias: d.categorias, unidades: d.unidades ?? [] });
      })
      .catch(() => setError("No se pudieron cargar las categorías de Defontana."));
  }

  function usarCategoriaDe(nombreCategoria: string) {
    const c = listas?.categorias.find((x) => sinTildes(x.nombre) === sinTildes(nombreCategoria));
    if (c) setCatId(String(c.id));
  }

  async function dejarManual() {
    if (!item) return;
    setError(null);
    setEnviando(true);
    try {
      const res = await fetch("/api/pedidos/modificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "aManual",
          pedidoId: pedido.pedidoId,
          fila: item.fila,
          codigoActual: item.codigo,
        }),
      });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo dejar el artículo como manual.");
      await onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red.");
    } finally {
      setEnviando(false);
    }
  }

  async function crearArticuloNuevo() {
    setError(null);
    if (!nombreNuevo.trim()) return setError("El artículo necesita un nombre.");
    if (!catId) return setError("Elige la categoría: un artículo no se crea sin categoría.");
    if (!unidadNueva) return setError("Elige la unidad.");
    setCreando(true);
    try {
      const res = await fetch("/api/pedidos/modificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "crearArticulo",
          pedidoId: pedido.pedidoId,
          fila: item?.fila,
          nombre: nombreNuevo,
          categoriaId: Number(catId),
          unidad: unidadNueva,
        }),
      });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo crear el artículo.");
      await onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red.");
    } finally {
      setCreando(false);
    }
  }

  useEffect(() => {
    caja.current?.focus();
    if (cabecera) {
      fetch("/api/solicitantes")
        .then((r) => r.json())
        .then((d) => setSolicitantes(d.solicitantes ?? []))
        .catch(() => {});
      fetch("/api/centros")
        .then((r) => r.json())
        .then((d) => setCentros(d.centros ?? []))
        .catch(() => setError("No se pudo cargar la lista de centros de negocio."));
      return;
    }
    fetch("/api/articulos")
      .then((r) => r.json())
      .then((d) => {
        const lista: { codigo: string; nombre: string; categoria: string; unidad: string }[] = [];
        for (const c of d.categorias ?? []) {
          for (const a of c.articulos ?? []) {
            lista.push({
              codigo: a.codigo,
              nombre: a.nombre,
              categoria: a.categoria,
              unidad: a.unidad,
            });
          }
        }
        setCatalogo(lista);
      })
      .catch(() => setError("No se pudo cargar el catálogo de artículos."));
  }, [cabecera]);

  const opciones: ComboOption[] = useMemo(
    () => catalogo.map((a) => ({ value: a.codigo, label: `${a.nombre} · ${a.codigo}` })),
    [catalogo]
  );

  // Solicitantes: la nómina más el actual (por si ya no figura en la planilla).
  const opcionesSolicitante: ComboOption[] = useMemo(() => {
    const nombres = new Set(solicitantes);
    if (pedido.solicitante) nombres.add(pedido.solicitante);
    return Array.from(nombres).map((n) => ({ value: n, label: n }));
  }, [solicitantes, pedido.solicitante]);

  // Centros del área elegida (prefijo del código). Si el área no cambia, el
  // centro actual se mantiene aunque ya no figure en la lista.
  const opcionesCentro: ComboOption[] = useMemo(() => {
    const prefijo = AREAS_PEDIDO.find((a) => a.label === area)?.prefijo ?? "";
    const lista = centros.filter(
      (c) => !prefijo || c.codigo.toUpperCase().startsWith(prefijo)
    );
    if (
      pedido.centroCodigo &&
      (!prefijo || pedido.centroCodigo.toUpperCase().startsWith(prefijo)) &&
      !lista.some((c) => c.codigo === pedido.centroCodigo)
    ) {
      lista.unshift({ codigo: pedido.centroCodigo, descripcion: pedido.centroNegocio });
    }
    return lista.map((c) => ({ value: c.codigo, label: c.descripcion }));
  }, [centros, area, pedido.centroCodigo, pedido.centroNegocio]);

  const elegido =
    catalogo.find((a) => a.codigo === codigo) ??
    (item && codigo === item.codigo
      ? { codigo: item.codigo, nombre: item.nombre, categoria: item.categoria, unidad: item.unidad }
      : null);

  async function guardar() {
    setError(null);
    let payload: Record<string, unknown>;
    if (cabecera) {
      const centro = opcionesCentro.find((c) => c.value === centroCodigo);
      if (!solicitante.trim()) return setError("Elige un solicitante.");
      if (!centro) return setError("Elige un centro de negocio.");
      payload = {
        accion: "cabecera",
        pedidoId: pedido.pedidoId,
        area,
        fechaEntrega,
        despacho,
        comentario,
        solicitante,
        centroCodigo: centro.value,
        centroNegocio: centro.label,
        clasificador1,
        clasificador2,
        urgente,
      };
    } else {
      if (!elegido) return setError("Elige un artículo.");
      const n = Number(cantidad);
      if (!Number.isFinite(n) || n <= 0) return setError("Ingresa una cantidad mayor a 0.");
      payload = {
        accion: item ? "linea" : "agregar",
        pedidoId: pedido.pedidoId,
        fila: item?.fila,
        codigoActual: item?.codigo,
        codigo: elegido.codigo,
        nombre: elegido.nombre,
        categoria: elegido.categoria,
        unidad: elegido.unidad,
        cantidad: n,
        comentarioArticulo: comentarioArt,
      };
    }
    setEnviando(true);
    try {
      const res = await fetch("/api/pedidos/modificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar.");
      await onGuardado(typeof data.nuevoPedidoId === "string" ? data.nuevoPedidoId : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red.");
    } finally {
      setEnviando(false);
    }
  }

  const titulo = cabecera
    ? "Editar datos del pedido"
    : item
      ? "Corregir artículo"
      : "Agregar artículo";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-primary/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCerrar();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !enviando) onCerrar();
      }}
    >
      <div
        ref={caja}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-card p-5 shadow-2xl outline-none"
      >
        <h3 className="text-base font-extrabold text-primary">
          {titulo} · {folioCorto(pedido.pedidoId)}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          El cambio queda registrado en el chat del pedido para que el solicitante lo vea.
        </p>

        <div className="mt-4 space-y-3">
          {cabecera ? (
            <>
              <div>
                <span className={labelClass}>Solicitante</span>
                <SearchCombobox
                  ariaLabel="Solicitante"
                  options={opcionesSolicitante}
                  value={solicitante}
                  onChange={setSolicitante}
                />
              </div>
              <label className="block">
                <span className={labelClass}>Área</span>
                <select
                  className={fieldClass}
                  value={area}
                  onChange={(e) => {
                    setArea(e.target.value);
                    // El centro elegido puede no ser de la nueva área.
                    setCentroCodigo("");
                  }}
                >
                  {!AREAS_PEDIDO.some((a) => a.label === area) && <option value={area}>{area}</option>}
                  {AREAS_PEDIDO.map((a) => (
                    <option key={a.label} value={a.label}>{a.label}</option>
                  ))}
                </select>
                {area !== pedido.area && (
                  <span className="mt-0.5 block text-xs font-semibold text-destructive">
                    Cambiarás el pedido de {pedido.area} a {area}: elige un centro de {area}. El pedido tomará un folio nuevo de esa área (el actual es {folioCorto(pedido.pedidoId)}).
                  </span>
                )}
              </label>
              <div>
                <span className={labelClass}>Centro de negocio</span>
                <SearchCombobox
                  ariaLabel="Centro de negocio"
                  options={opcionesCentro}
                  value={centroCodigo}
                  onChange={setCentroCodigo}
                />
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Solo centros del área elegida ({area}).
                </span>
              </div>
              <label className="block">
                <span className={labelClass}>Clasificador 1</span>
                <select className={fieldClass} value={clasificador1} onChange={(e) => setClasificador1(e.target.value)}>
                  <option value="">—</option>
                  {!CLASIFICADORES_1.includes(clasificador1) && clasificador1 && (
                    <option value={clasificador1}>{clasificador1}</option>
                  )}
                  {CLASIFICADORES_1.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelClass}>Clasificador 2</span>
                <select className={fieldClass} value={clasificador2} onChange={(e) => setClasificador2(e.target.value)}>
                  <option value="">—</option>
                  {!CLASIFICADORES_2.includes(clasificador2) && clasificador2 && (
                    <option value={clasificador2}>{clasificador2}</option>
                  )}
                  {CLASIFICADORES_2.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-primary">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-accent"
                  checked={urgente}
                  onChange={(e) => setUrgente(e.target.checked)}
                />
                Pedido urgente
              </label>
              <label className="block">
                <span className={labelClass}>Entrega comprometida</span>
                <input type="date" className={fieldClass} value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} />
              </label>
              <label className="block">
                <span className={labelClass}>Despacho</span>
                <input className={fieldClass} value={despacho} onChange={(e) => setDespacho(e.target.value)} />
              </label>
              <label className="block">
                <span className={labelClass}>Comentario del pedido</span>
                <textarea
                  rows={3}
                  className={`${fieldClass} h-auto py-2`}
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              {esManualItem && (
                <div className="rounded-xl border border-border bg-muted/40 p-3">
                  {!crearAbierto ? (
                    <button
                      type="button"
                      onClick={abrirCrear}
                      className="text-sm font-bold text-accent hover:underline"
                    >
                      + Crear este artículo en Defontana
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm font-bold text-primary">Crear artículo en Defontana</p>
                      <label className="block">
                        <span className={labelClass}>Nombre</span>
                        <input
                          className={fieldClass}
                          value={nombreNuevo}
                          onChange={(e) => setNombreNuevo(e.target.value)}
                        />
                      </label>
                      {similares.length > 0 && (
                        <div
                          role="alert"
                          className="rounded-lg border border-warning/40 bg-warning-surface px-3 py-2 text-xs text-warning"
                        >
                          <p className="font-bold">
                            {hayExacto
                              ? "Este artículo ya existe en el catálogo. No lo crees de nuevo:"
                              : "Hay artículos muy parecidos en el catálogo. ¿Es alguno de estos?"}
                          </p>
                          <ul className="mt-1 space-y-1">
                            {similares.map(({ c, exacto }) => (
                              <li key={c.codigo} className="flex items-center justify-between gap-2">
                                <span className="min-w-0 text-card-foreground">
                                  {c.nombre} · {c.codigo}
                                  {exacto && <b className="ml-1 text-warning">(mismo nombre)</b>}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCodigo(c.codigo);
                                    setCrearAbierto(false);
                                  }}
                                  className="shrink-0 rounded-md bg-accent px-2 py-1 font-bold text-accent-foreground hover:bg-accent-hover"
                                >
                                  Usar este
                                </button>
                              </li>
                            ))}
                          </ul>
                          {hayExacto && (
                            <p className="mt-1">
                              Para crear uno igual, cambia el nombre.
                            </p>
                          )}
                        </div>
                      )}
                      <div>
                        <span className={labelClass}>Buscar artículos parecidos</span>
                        <input
                          className={fieldClass}
                          value={busqCat}
                          onChange={(e) => setBusqCat(e.target.value)}
                          placeholder="Escribe parte del nombre…"
                        />
                        <ul className="mt-1 max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card text-xs">
                          {parecidos.length === 0 ? (
                            <li className="px-2 py-1.5 text-muted-foreground">
                              Sin artículos parecidos en el catálogo.
                            </li>
                          ) : (
                            parecidos.map((a) => (
                              <li key={a.codigo}>
                                <button
                                  type="button"
                                  onClick={() => usarCategoriaDe(a.categoria)}
                                  title="Usar esta categoría"
                                  className="flex w-full items-start justify-between gap-2 px-2 py-1.5 text-left hover:bg-muted"
                                >
                                  <span className="text-card-foreground">{a.nombre}</span>
                                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-semibold text-primary">
                                    {a.categoria || "Sin categoría"}
                                  </span>
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Toca uno para usar su categoría.
                        </span>
                      </div>
                      <label className="block">
                        <span className={labelClass}>Categoría (obligatoria)</span>
                        <select
                          className={fieldClass}
                          value={catId}
                          onChange={(e) => setCatId(e.target.value)}
                          disabled={!listas}
                        >
                          <option value="">{listas ? "Elige una categoría…" : "Cargando…"}</option>
                          {listas?.categorias.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nombre}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className={labelClass}>Unidad</span>
                        <select
                          className={fieldClass}
                          value={unidadNueva}
                          onChange={(e) => setUnidadNueva(e.target.value)}
                          disabled={!listas}
                        >
                          {listas?.unidades.map((u) => (
                            <option key={u.codigo} value={u.codigo}>
                              {u.codigo} · {u.nombre}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => void crearArticuloNuevo()}
                        disabled={creando || enviando || !listas || hayExacto}
                        className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
                      >
                        {creando ? "Creando…" : "Crear artículo"}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div>
                <span className={labelClass}>Artículo</span>
                {fijo ? (
                  <p className="rounded-lg bg-muted px-3 py-2 text-sm text-card-foreground">
                    {item?.nombre}
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Ya tiene recepción o consumo registrado: solo puedes cambiar la cantidad.
                    </span>
                  </p>
                ) : (
                  <SearchCombobox
                    ariaLabel="Artículo"
                    placeholder="Buscar artículo…"
                    options={opciones}
                    value={codigo}
                    onChange={setCodigo}
                    autoFocus={!item}
                  />
                )}
                {item && !fijo && item.codigo !== CODIGO_ARTICULO_MANUAL && (
                  <button
                    type="button"
                    onClick={() => void dejarManual()}
                    disabled={enviando}
                    className="mt-1 text-xs font-bold text-accent hover:underline disabled:opacity-60"
                  >
                    Dejar como artículo manual (sin código)
                  </button>
                )}
              </div>
              <label className="block">
                <span className={labelClass}>
                  Cantidad{elegido ? ` (${elegido.unidad})` : ""}
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  className={fieldClass}
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                />
                {item && (item.cantidadRecibida ?? 0) > 0 && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Ya recibidos: {item.cantidadRecibida}
                  </span>
                )}
              </label>
              <label className="block">
                <span className={labelClass}>Comentario del artículo</span>
                <input className={fieldClass} value={comentarioArt} onChange={(e) => setComentarioArt(e.target.value)} placeholder="Opcional" />
              </label>
            </>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={enviando}
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={enviando}
            className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm hover:bg-accent-hover disabled:opacity-60"
          >
            {enviando ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DialogoEliminar({
  nombre,
  pedidoId,
  error,
  enviando,
  onCancelar,
  onConfirmar,
}: {
  nombre: string;
  pedidoId: string;
  error: string | null;
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    caja.current?.focus();
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-primary/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCancelar();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !enviando) onCancelar();
      }}
    >
      <div
        ref={caja}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Eliminar artículo del pedido"
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-card p-5 shadow-2xl outline-none"
      >
        <h3 className="text-base font-extrabold text-primary">
          Eliminar artículo del pedido {folioCorto(pedidoId)}
        </h3>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Se quitará <strong className="text-card-foreground">{nombre}</strong>{" "}
          de la planilla. Esta acción no se puede deshacer. Si lo que quieres es
          descartar el pedido completo, usa «Anular».
        </p>
        {error && (
          <p role="alert" className="mt-2 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            disabled={enviando}
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={enviando}
            className="inline-flex h-9 items-center rounded-lg bg-destructive px-4 text-sm font-bold text-destructive-foreground shadow-sm hover:opacity-90 disabled:opacity-60"
          >
            {enviando ? "Eliminando…" : "Eliminar artículo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DialogoAnularLinea({
  nombre,
  pedidoId,
  error,
  enviando,
  onCancelar,
  onConfirmar,
}: {
  nombre: string;
  pedidoId: string;
  error: string | null;
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const [motivo, setMotivo] = useState("");
  useEffect(() => {
    caja.current?.focus();
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-primary/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCancelar();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !enviando) onCancelar();
      }}
    >
      <div
        ref={caja}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Anular artículo del pedido"
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-card p-5 shadow-2xl outline-none"
      >
        <h3 className="text-base font-extrabold text-primary">
          Anular artículo del pedido {folioCorto(pedidoId)}
        </h3>
        <p className="mt-1.5 text-sm text-muted-foreground">
          <strong className="text-card-foreground">{nombre}</strong> dejará de
          contar en el pedido y no se podrá recibir. Queda en la planilla,
          marcado como anulado, y puedes reactivarlo si fue un error.
        </p>
        <label className="mt-3 block">
          <span className={labelClass}>Motivo (quién lo pidió y por qué)</span>
          <textarea
            className={`${fieldClass} h-20 resize-none py-2`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            disabled={enviando}
            placeholder="Ej.: el supervisor ya no lo necesita"
          />
        </label>
        {error && (
          <p role="alert" className="mt-2 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            disabled={enviando}
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirmar(motivo.trim())}
            disabled={enviando || !motivo.trim()}
            className="inline-flex h-9 items-center rounded-lg bg-destructive px-4 text-sm font-bold text-destructive-foreground shadow-sm hover:opacity-90 disabled:opacity-60"
          >
            {enviando ? "Anulando…" : "Anular artículo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-card px-1 font-sans text-[10px] font-semibold text-secondary">
      {children}
    </kbd>
  );
}

function Detalle({
  pedido,
  sinLeer,
  onActividad,
  ediciones,
  guardando,
  guardado,
  errores,
  guardandoTodo,
  empleados,
  cambios,
  seleccionFilas,
  posicion,
  total,
  onAnterior,
  onSiguiente,
  onCambiar,
  onMarcarRecibido,
  onGuardarLinea,
  onGuardarPedido,
  onAlternarFila,
  onAlternarTodasLasFilas,
  onAccion,
  onConsumo,
  onAplicarATodos,
  hayCambiosPendientes,
  onModificar,
  onEliminar,
  onAnularLinea,
  onReactivarLinea,
  onOcAsociada,
}: {
  pedido: PedidoResumen;
  /** Se asoció (o quitó, con "") una OC a estas filas. */
  onOcAsociada: (
    filas: number[],
    oc: string,
    /** Artículos manuales que se crearon en Defontana junto con la OC. */
    articulosCreados?: { fila: number; codigo: string; categoria: string }[]
  ) => void;
  ediciones: Record<number, LineaEdit>;
  guardando: Record<number, boolean>;
  guardado: Record<number, boolean>;
  errores: Record<number, string>;
  guardandoTodo: boolean;
  empleados: ComboOption[];
  cambios: number;
  seleccionFilas: Set<number>;
  posicion: number;
  total: number;
  onAnterior: () => void;
  onSiguiente: () => void;
  onCambiar: (it: PedidoItem, campo: keyof LineaEdit, valor: string) => void;
  onMarcarRecibido: (items: PedidoItem[]) => void;
  /** Mensajes del chat sin leer para este pedido. */
  sinLeer: number;
  onActividad: () => void;
  onGuardarLinea: (it: PedidoItem) => Promise<boolean>;
  onGuardarPedido: () => void;
  onAlternarFila: (fila: number) => void;
  onAlternarTodasLasFilas: (items: PedidoItem[]) => void;
  onAccion: (tipo: "cerrado" | "anulado" | "") => void;
  onConsumo: () => void;
  onAplicarATodos: (
    items: PedidoItem[],
    campos: Partial<Omit<LineaEdit, "cantidadRecibida">>
  ) => void;
  /** Hay filas editadas sin guardar en algún pedido: no se puede eliminar. */
  hayCambiosPendientes: boolean;
  onEliminar: (it: PedidoItem) => void;
  onAnularLinea: (it: PedidoItem) => void;
  onReactivarLinea: (it: PedidoItem) => Promise<void>;
  onModificar: (
    m: { tipo: "linea"; item: PedidoItem } | { tipo: "agregar" } | { tipo: "cabecera" }
  ) => void;
}) {
  const bloqueado = pedido.estadoManual !== "";
  const sinCambios = cambios === 0;
  const abierto = ["pendiente", "parcial"].includes(estadoDe(pedido));
  const [datosAbiertos, setDatosAbiertos] = useState(false);
  // OC asociadas a los artículos: se leen de Defontana (proveedor, fecha, estado).
  const [asociando, setAsociando] = useState(false);
  const [creandoOC, setCreandoOC] = useState(false);
  const [ocInfos, setOcInfos] = useState<Record<string, InfoOC>>({});
  const ocsAsociadas = Array.from(
    new Set(pedido.items.map((i) => i.ocAsociada).filter(Boolean))
  ).sort();
  const ocsClave = ocsAsociadas.join(",");
  useEffect(() => {
    if (!ocsClave) return;
    const ctl = new AbortController();
    fetch(`/api/pedidos/oc?pedidoId=${encodeURIComponent(pedido.pedidoId)}`, {
      cache: "no-store",
      signal: ctl.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (r.ok) setOcInfos(d.ordenes ?? {});
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [ocsClave, pedido.pedidoId]);
  // Datos comunes a todo el pedido: se escriben una vez y se copian a cada artículo.
  const [todosPersona, setTodosPersona] = useState("");
  const [todosBodega, setTodosBodega] = useState("");
  const [todosEntrega, setTodosEntrega] = useState("");
  const hayDatosTodos = Boolean(todosPersona.trim() || todosBodega || todosEntrega);
  const vigentes = pedido.items.filter((it) => !it.anulado);
  const totalUnid = vigentes.reduce((a, it) => a + it.cantidad, 0);
  const recibUnid = vigentes.reduce((a, it) => {
    const ed = ediciones[it.fila];
    const v =
      ed && ed.cantidadRecibida.trim() !== ""
        ? Number(ed.cantidadRecibida)
        : it.cantidadRecibida;
    return a + (Number.isFinite(v) && v ? Math.min(v as number, it.cantidad) : 0);
  }, 0);
  const pctUnid = totalUnid ? Math.min(100, (recibUnid / totalUnid) * 100) : 0;
  const puedeCerrar = ["pendiente", "parcial", "completo"].includes(
    estadoDe(pedido)
  );
  const todasSeleccionadas =
    vigentes.length > 0 && vigentes.every((it) => seleccionFilas.has(it.fila));
  /** Suelta la OC asociada a un artículo (solo la anotación de la planilla). */
  const quitarOC = async (it: (typeof vigentes)[number]) => {
    if (
      !window.confirm(
        `¿Quitar la OC ${it.ocAsociada} de «${it.nombre}»? Solo se borra la asociación en la planilla; en Defontana no cambia nada.`
      )
    )
      return;
    try {
      const res = await fetch("/api/pedidos/oc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedidoId: pedido.pedidoId, oc: "", filas: [it.fila] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo quitar la OC.");
      onOcAsociada([it.fila], "");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo quitar la OC.");
    }
  };

  const seleccionadas = vigentes.filter((it) => seleccionFilas.has(it.fila));
  // Los artículos que ya tienen OC se ignoran: Crear/Asociar OC solo usan el resto.
  const conOC = seleccionadas.filter((it) => it.ocAsociada);
  const sinOC = seleccionadas.filter((it) => !it.ocAsociada);

  const estado = ESTADOS[estadoDe(pedido)];
  const faltantes = vigentes.filter((it) => {
    const ed = ediciones[it.fila];
    const rec =
      ed && ed.cantidadRecibida.trim() !== ""
        ? Number(ed.cantidadRecibida)
        : it.cantidadRecibida;
    return rec === null || rec < it.cantidad;
  });

  const bodega = fechaBodegaPedido(pedido);
  const real = fechaRecepcionPedido(pedido);
  const aTiempo = entregadoATiempo(pedido);
  const atrasado = esAtrasado(pedido);

  const urgenteTag = (
    <span className="ml-1.5 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-destructive-foreground">
      Urgente
    </span>
  );

  // Datos clave siempre visibles; el resto, plegado.
  const clave: { label: string; valor: React.ReactNode }[] = [
    { label: "Solicitante", valor: pedido.solicitante || "—" },
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
    { label: "Despacho", valor: pedido.despacho || "—" },
    {
      label: "Entrega comprometida",
      valor: (
        <>
          {pedido.fechaEntrega ? formatFechaEntrega(pedido.fechaEntrega) : "—"}
          {pedido.urgente && urgenteTag}
          {atrasado && (
            <span className="ml-1.5 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-destructive">
              Atrasado
            </span>
          )}
        </>
      ),
    },
  ];

  const extra: { label: string; valor: React.ReactNode }[] = [
    { label: "Folio completo", valor: pedido.pedidoId },
    { label: "Área", valor: pedido.area || "—" },
    { label: "Fecha del pedido", valor: formatFecha(pedido.fecha) },
    {
      label: "Llegó a bodega",
      valor: bodega ? formatFecha(bodega.toISOString()) : "Sin registro",
    },
    {
      label: "Fecha de entrega real",
      valor: real ? (
        <>
          {formatFecha(real.toISOString())}
          {aTiempo !== null && (
            <span
              className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${
                aTiempo
                  ? "bg-success-surface text-success"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {aTiempo ? "A tiempo" : "Atrasado"}
            </span>
          )}
        </>
      ) : estadoDe(pedido) === "completo" ? (
        "Sin registro"
      ) : (
        "Pendiente"
      ),
    },
    { label: "Clasificador 1", valor: pedido.clasificador1 || "—" },
    { label: "Clasificador 2", valor: pedido.clasificador2 || "—" },
  ];

  return (
    <>
      <div className="z-20 flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b border-border/60 bg-card px-4 py-3 lg:sticky lg:top-[3.6rem]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              title={pedido.pedidoId}
              className="text-lg font-extrabold tracking-tight text-primary"
            >
              {folioCorto(pedido.pedidoId)}
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
            <span className="text-sm text-muted-foreground">
              {vigentes.length}{" "}
              {vigentes.length === 1 ? "artículo" : "artículos"}
              {vigentes.length < pedido.items.length &&
                ` (+${pedido.items.length - vigentes.length} anulado${pedido.items.length - vigentes.length === 1 ? "" : "s"})`}{" "}
              · pedido el{" "}
              {formatFecha(pedido.fecha)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-card shadow-sm">
            <button
              type="button"
              onClick={onAnterior}
              disabled={posicion <= 0}
              aria-label="Pedido anterior"
              title="Pedido anterior (K)"
              className="grid h-9 w-9 place-items-center rounded-l-lg text-secondary transition-colors hover:bg-muted disabled:opacity-30"
            >
              <IconChevron dir="left" />
            </button>
            <span className="px-1 text-xs tabular-nums text-muted-foreground">
              {posicion + 1}/{total}
            </span>
            <button
              type="button"
              onClick={onSiguiente}
              disabled={posicion === -1 || posicion >= total - 1}
              aria-label="Pedido siguiente"
              title="Pedido siguiente (J)"
              className="grid h-9 w-9 place-items-center rounded-r-lg text-secondary transition-colors hover:bg-muted disabled:opacity-30"
            >
              <IconChevron dir="right" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => onMarcarRecibido(faltantes)}
            disabled={faltantes.length === 0 || bloqueado}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-bold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              faltantes.length === 0 || bloqueado
                ? "border border-border bg-card text-primary hover:bg-muted"
                : "bg-success text-white hover:opacity-90"
            }`}
          >
            <IconCheck />
            Todo recibido
          </button>
          {!bloqueado && (
            <>
            <button
              type="button"
              onClick={() => setAsociando(true)}
              disabled={sinOC.length === 0}
              title={
                seleccionadas.length === 0
                  ? "Marca los artículos de la tabla que están en la OC"
                  : sinOC.length === 0
                    ? "Los artículos marcados ya tienen OC"
                    : "Asociar una orden de compra de Defontana a los artículos marcados sin OC"
              }
              className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              Asociar OC{sinOC.length > 0 ? ` (${sinOC.length})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setCreandoOC(true)}
              disabled={sinOC.length === 0}
              title={
                seleccionadas.length === 0
                  ? "Marca los artículos de la tabla que irán en la nueva OC"
                  : sinOC.length === 0
                    ? "Los artículos marcados ya tienen OC"
                    : "Crear en Defontana una OC con los artículos marcados sin OC"
              }
              className="inline-flex h-9 items-center rounded-lg bg-accent px-3 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Crear OC{sinOC.length > 0 ? ` (${sinOC.length})` : ""}
            </button>
            </>
          )}
          {!bloqueado && (
            <button
              type="button"
              onClick={onConsumo}
              disabled={
                !sinCambios ||
                !pedido.items.some((i) => (i.cantidadRecibida ?? 0) > 0)
              }
              title={
                !sinCambios
                  ? "Guarda o descarta los cambios primero"
                  : "Registrar en Defontana el consumo interno de artículos ya recibidos"
              }
              className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              Consumo interno
            </button>
          )}
          {bloqueado ? (
            <button
              type="button"
              onClick={() => onAccion("")}
              disabled={!sinCambios}
              className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted disabled:opacity-40"
            >
              Reabrir
            </button>
          ) : (
            <>
              {puedeCerrar && (
                <button
                  type="button"
                  onClick={() => onAccion("cerrado")}
                  disabled={!sinCambios}
                  title={
                    !sinCambios
                      ? "Guarda o descarta los cambios primero"
                      : abierto
                        ? "Dar por terminado aunque falten artículos"
                        : "Finalizar y archivar el pedido"
                  }
                  className={`inline-flex h-9 items-center rounded-lg border px-3 text-sm font-semibold shadow-sm transition-colors disabled:opacity-40 ${
                    abierto
                      ? "border-border bg-card text-secondary hover:bg-muted"
                      : "border-success/40 bg-success-surface text-success hover:bg-success-surface/60"
                  }`}
                >
                  Cerrar pedido
                </button>
              )}
              <button
                type="button"
                onClick={() => onAccion("anulado")}
                disabled={!sinCambios}
                title={
                  sinCambios
                    ? "Anular un pedido enviado por error"
                    : "Guarda o descarta los cambios primero"
                }
                className="inline-flex h-9 items-center rounded-lg border border-destructive/40 bg-card px-3 text-sm font-semibold text-destructive shadow-sm transition-colors hover:bg-destructive/5 disabled:opacity-40"
              >
                Anular
              </button>
            </>
          )}
          {cambios > 0 || guardandoTodo ? (
            <button
              type="button"
              onClick={onGuardarPedido}
              disabled={guardandoTodo || bloqueado}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {guardandoTodo ? "Guardando…" : `Guardar pedido (${cambios})`}
            </button>
          ) : (
            !bloqueado && (
              <span
                aria-live="polite"
                className="inline-flex h-9 items-center gap-1.5 px-2 text-sm font-medium text-muted-foreground"
              >
                <IconCheck />
                Todo guardado
              </span>
            )
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 pb-3">
        <span
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={totalUnid}
          aria-valuenow={recibUnid}
          aria-label="Unidades recibidas"
          className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <span
            className="block h-full rounded-full bg-success transition-[width]"
            style={{ width: `${pctUnid}%` }}
          />
        </span>
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
          {recibUnid.toLocaleString("es-CL")} de{" "}
          {totalUnid.toLocaleString("es-CL")} unid. recibidas
        </span>
      </div>

      {bloqueado && (
        <div
          role="status"
          className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2.5 text-sm ${
            pedido.estadoManual === "anulado"
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-border bg-muted text-secondary"
          }`}
        >
          <b>
            Pedido {pedido.estadoManual === "anulado" ? "anulado" : "cerrado"}
          </b>
          <span className="min-w-0 flex-1 break-words">
            {pedido.motivoEstado || "Sin motivo registrado."}
          </span>
          <span className="text-xs opacity-80">
            Reábrelo para volver a editarlo.
          </span>
        </div>
      )}

      <div className="border-y border-border bg-muted/30 px-4 py-2.5">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
          {clave.map((d) => (
            <div key={d.label} className="min-w-0">
              <dt className={labelClass}>{d.label}</dt>
              <dd className="break-words text-card-foreground">{d.valor}</dd>
            </div>
          ))}
        </dl>
        {pedido.comentario && (
          <p className="mt-2 break-words rounded-md bg-card px-2.5 py-1.5 text-sm text-card-foreground ring-1 ring-border">
            <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Comentario
            </span>
            {pedido.comentario}
          </p>
        )}
        {datosAbiertos && (
          <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-border/70 pt-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            {extra.map((d) => (
              <div key={d.label} className="min-w-0">
                <dt className={labelClass}>{d.label}</dt>
                <dd className="break-words text-card-foreground">{d.valor}</dd>
              </div>
            ))}
          </dl>
        )}
        <button
          type="button"
          onClick={() => setDatosAbiertos((v) => !v)}
          aria-expanded={datosAbiertos}
          className="mt-1.5 text-xs font-semibold text-accent hover:underline"
        >
          {datosAbiertos
            ? "Ocultar datos del pedido"
            : "Ver más datos (área, clasificadores, fechas)"}
        </button>
        {!bloqueado && (
          <span className="ml-4 mt-1.5 inline-flex gap-4">
            <button
              type="button"
              onClick={() => onModificar({ tipo: "cabecera" })}
              className="text-xs font-semibold text-accent hover:underline"
            >
              Editar datos del pedido
            </button>
            <button
              type="button"
              onClick={() => onModificar({ tipo: "agregar" })}
              className="text-xs font-semibold text-accent hover:underline"
            >
              + Agregar artículo
            </button>
          </span>
        )}
      </div>

      {!bloqueado && vigentes.length > 1 && (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 border-b border-border bg-accent/[0.03] px-4 py-2.5">
          <p className="mr-1 w-full text-xs font-bold text-accent sm:w-auto sm:pb-2.5">
            Aplicar a los {vigentes.length} artículos
          </p>
          <label className="block w-52">
            <span className={labelClass}>Recepcionado por</span>
            <SearchCombobox
              size="sm"
              allowCustom
              clearable
              ariaLabel="Recepcionado por (todo el pedido)"
              placeholder="Buscar persona…"
              options={empleados}
              value={todosPersona}
              onChange={setTodosPersona}
            />
          </label>
          <label className="block w-36">
            <span className={labelClass}>Llegó a bodega</span>
            <input
              type="date"
              className={fieldClass}
              value={todosBodega}
              onChange={(e) => setTodosBodega(e.target.value)}
            />
          </label>
          <label className="block w-36">
            <span className={labelClass}>Entregado el</span>
            <input
              type="date"
              className={fieldClass}
              value={todosEntrega}
              onChange={(e) => setTodosEntrega(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={!hayDatosTodos}
            onClick={() => {
              onAplicarATodos(vigentes, {
                recepcionadoPor: todosPersona.trim(),
                fechaRecepcionBodega: todosBodega,
                fechaEntregaSolicitante: todosEntrega,
              });
              setTodosPersona("");
              setTodosBodega("");
              setTodosEntrega("");
            }}
            className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Aplicar a todos
          </button>
        </div>
      )}

      <div className="px-4 pb-3">
        <ChatPedido
          folio={pedido.pedidoId}
          rol="adquisiciones"
          sinLeer={sinLeer}
          onActividad={onActividad}
        />
        {pedido.sinCorreo && <CorreoFaltante folio={pedido.pedidoId} />}
        <ReportarCorreo folio={pedido.pedidoId} items={vigentes} />
        {!bloqueado && conOC.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {conOC.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {sinOC.length === 0
                  ? "Los artículos marcados ya tienen OC."
                  : `${conOC.length} de los marcados ya tienen OC y se dejan fuera.`}
              </span>
            )}
          </div>
        )}
      </div>

      {creandoOC && (
        <DialogoCrearOC
          pedido={pedido}
          items={sinOC}
          onCerrar={() => setCreandoOC(false)}
          onEditarManual={(it) => {
            setCreandoOC(false);
            onModificar({ tipo: "linea", item: it });
          }}
          onCreada={(filas, oc, articulosCreados) => {
            setCreandoOC(false);
            onOcAsociada(filas, oc, articulosCreados);
          }}
        />
      )}

      {asociando && (
        <DialogoAsociarOC
          pedidoId={pedido.pedidoId}
          items={sinOC}
          onCerrar={() => setAsociando(false)}
          onGuardado={(oc) => {
            setAsociando(false);
            onOcAsociada(
              sinOC.map((i) => i.fila),
              oc
            );
          }}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm max-lg:block lg:min-w-[1340px]">
          <thead className="max-lg:hidden">
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pl-4 pr-1.5 font-semibold">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-accent"
                  aria-label="Seleccionar todos los artículos"
                  disabled={bloqueado}
                  checked={todasSeleccionadas}
                  onChange={() => onAlternarTodasLasFilas(vigentes)}
                />
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">Artículo</th>
              <th scope="col" className="px-2 py-2 font-semibold">Pedido</th>
              <th scope="col" className="px-2 py-2 font-semibold">Recibido</th>
              <th scope="col" className="px-2 py-2 font-semibold">Llegó a bodega</th>
              <th scope="col" className="px-2 py-2 font-semibold">Recepcionado por</th>
              <th scope="col" className="px-2 py-2 font-semibold">Entregado el</th>
              <th scope="col" className="px-2 py-2 font-semibold">Consumo interno</th>
              <th className="py-2 pl-2 pr-4 text-right font-semibold">
                <span className="sr-only">Guardar</span>
              </th>
            </tr>
          </thead>
          <tbody className="max-lg:block">
            {pedido.items.map((it) => {
              const edicion = ediciones[it.fila] ?? lineaEditDesdeItem(it);
              const sucia = tieneCambios(it, ediciones[it.fila]);
              const recNum =
                edicion.cantidadRecibida.trim() === ""
                  ? null
                  : Number(edicion.cantidadRecibida);
              const bajoLoPedido = recNum !== null && recNum < it.cantidad;
              const completaEdit = recNum !== null && recNum >= it.cantidad;
              const estadoIt = ESTADOS[estadoLinea(it)];
              const enter = (e: React.KeyboardEvent) => {
                if (e.key === "Enter" && sucia && !guardando[it.fila]) {
                  e.preventDefault();
                  void onGuardarLinea(it);
                }
              };
              const seleccionada = seleccionFilas.has(it.fila);
              const hoy = hoyYMD();
              const lock = bloqueado || it.anulado;
              const fondoFila = it.anulado
                ? "bg-muted/60 opacity-60"
                : seleccionada
                  ? "bg-accent/10"
                  : sucia
                    ? "bg-accent/5"
                    : estadoLinea(it) === "completo"
                      ? "bg-[#bdefd6]"
                      : estadoLinea(it) === "parcial"
                        ? "bg-[#fed7aa]"
                        : estadoLinea(it) === "pendiente"
                          ? "bg-[#e3e9f2]"
                          : "";
              const infoOC = it.ocAsociada ? ocInfos[it.ocAsociada] : undefined;
              const dato = "font-semibold text-card-foreground";
              return (
                <Fragment key={it.fila}>
                <tr
                  className={`align-top max-lg:relative max-lg:grid max-lg:grid-cols-2 max-lg:gap-x-3 max-lg:gap-y-3 max-lg:p-3 lg:border-b-0 ${fondoFila}`}
                >
                  <td className="py-2 pl-4 pr-1.5 pt-3 max-lg:absolute max-lg:right-3 max-lg:top-3 max-lg:p-0">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-accent"
                      aria-label={`Seleccionar ${it.nombre}`}
                      disabled={lock}
                      checked={seleccionada}
                      onChange={() => onAlternarFila(it.fila)}
                    />
                  </td>
                  <td
                    className={`border-l-4 py-2 pl-2 pr-3 max-lg:col-span-2 max-lg:py-0 max-lg:pr-8 ${
                      sucia
                        ? "border-l-accent"
                        : estadoLinea(it) === "completo"
                          ? "border-l-success"
                          : estadoLinea(it) === "parcial"
                            ? "border-l-warning"
                            : estadoLinea(it) === "pendiente"
                              ? "border-l-slate-400"
                              : "border-l-transparent"
                    }`}
                  >
                    <div
                      className={`font-medium leading-snug text-card-foreground ${
                        it.anulado ? "line-through" : ""
                      }`}
                    >
                      {it.nombre}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{it.codigo}</span>
                      {it.categoria && <span>· {it.categoria}</span>}
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-px text-[11px] font-semibold ${
                          it.anulado
                            ? ESTADOS.anulado.chip
                            : estadoLinea(it) === "parcial"
                              ? "bg-warning-surface text-warning ring-1 ring-warning/40"
                              : `${estadoIt.chip} ${
                                  estadoLinea(it) === "completo" ? "ring-1 ring-success/40" : ""
                                }`
                        }`}
                      >
                        {it.anulado ? ESTADOS.anulado.label : estadoIt.label}
                      </span>
                    </div>
                    {it.anulado && it.motivoAnulacion && (
                      <p className="mt-1 max-w-[260px] text-xs font-medium text-destructive max-lg:max-w-none">
                        Motivo: {it.motivoAnulacion}
                      </p>
                    )}
                    {it.comentarioArticulo && (
                      <p className="mt-1 max-w-[260px] text-xs italic max-lg:max-w-none text-muted-foreground">
                        {it.comentarioArticulo}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 pt-2.5 tabular-nums max-lg:p-0">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:hidden">Pedido</span>
                    <span className="text-base font-bold text-primary">
                      {it.cantidad.toLocaleString("es-CL")}
                    </span>{" "}
                    <span className="text-muted-foreground">{it.unidad}</span>
                  </td>
                  <td className="px-2 py-2 max-lg:p-0">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:hidden">Recibido</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        max={it.cantidad}
                        step="any"
                        inputMode="decimal"
                        disabled={lock}
                        aria-label={`Cantidad recibida de ${it.nombre}`}
                        className={`${fieldClass} w-[76px]! shrink-0 tabular-nums ${
                          bajoLoPedido ? "border-warning" : ""
                        } ${completaEdit ? "border-success/60 bg-success-surface" : ""}`}
                        placeholder="—"
                        value={edicion.cantidadRecibida}
                        onChange={(e) => {
                          const raw = e.target.value;
                          // Rara vez llega más de lo pedido: se topa a la
                          // cantidad pedida en vez de dejar escribir de más.
                          const n = Number(raw);
                          const valor =
                            raw !== "" &&
                            Number.isFinite(n) &&
                            n > it.cantidad
                              ? String(it.cantidad)
                              : raw;
                          onCambiar(it, "cantidadRecibida", valor);
                        }}
                        onKeyDown={enter}
                      />
                      <button
                        type="button"
                        title="Recibido completo"
                        aria-label={`Marcar ${it.nombre} como recibido completo`}
                        onClick={() =>
                          onCambiar(it, "cantidadRecibida", String(it.cantidad))
                        }
                        disabled={lock || (completaEdit && recNum === it.cantidad)}
                        className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-card px-2 text-xs font-semibold text-secondary transition-colors hover:bg-muted disabled:opacity-40"
                      >
                        Todo
                      </button>
                    </div>
                    {bajoLoPedido && (
                      <p className="mt-0.5 text-[11px] font-medium text-warning">
                        Menor a lo pedido
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-2 max-lg:col-span-2 max-lg:p-0">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:hidden">Llegó a bodega</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="date"
                        disabled={lock}
                        aria-label={`Fecha en que llegó a bodega ${it.nombre}`}
                        className={`${fieldClass} w-[136px]! shrink-0 max-lg:w-auto! max-lg:min-w-0 max-lg:flex-1`}
                        value={edicion.fechaRecepcionBodega}
                        onChange={(e) =>
                          onCambiar(it, "fechaRecepcionBodega", e.target.value)
                        }
                        onKeyDown={enter}
                      />
                      <button
                        type="button"
                        title="Poner la fecha de hoy"
                        aria-label={`Llegó hoy a bodega ${it.nombre}`}
                        onClick={() => onCambiar(it, "fechaRecepcionBodega", hoy)}
                        disabled={lock || edicion.fechaRecepcionBodega === hoy}
                        className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-card px-2 text-xs font-semibold text-secondary transition-colors hover:bg-muted disabled:opacity-40"
                      >
                        Hoy
                      </button>
                    </div>
                  </td>
                  <td className="px-2 py-2 max-lg:col-span-2 max-lg:p-0">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:hidden">Recepcionado por</span>
                    <div className="w-[230px] max-lg:w-full" title={edicion.recepcionadoPor || undefined}>
                      <SearchCombobox
                        size="sm"
                        allowCustom
                        clearable
                        disabled={lock}
                        ariaLabel={`Quién recepcionó ${it.nombre}`}
                        placeholder="Buscar persona…"
                        options={empleados}
                        value={edicion.recepcionadoPor}
                        onChange={(v) => onCambiar(it, "recepcionadoPor", v)}
                      />
                    </div>
                  </td>
                  <td className="px-2 py-2 max-lg:col-span-2 max-lg:p-0">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:hidden">Entregado el</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="date"
                        disabled={lock}
                        aria-label={`Fecha en que se entregó al solicitante ${it.nombre}`}
                        className={`${fieldClass} w-[136px]! shrink-0 max-lg:w-auto! max-lg:min-w-0 max-lg:flex-1`}
                        value={edicion.fechaEntregaSolicitante}
                        onChange={(e) =>
                          onCambiar(it, "fechaEntregaSolicitante", e.target.value)
                        }
                        onKeyDown={enter}
                      />
                      <button
                        type="button"
                        title="Poner la fecha de hoy"
                        aria-label={`Entregado hoy ${it.nombre}`}
                        onClick={() =>
                          onCambiar(it, "fechaEntregaSolicitante", hoy)
                        }
                        disabled={lock || edicion.fechaEntregaSolicitante === hoy}
                        className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-card px-2 text-xs font-semibold text-secondary transition-colors hover:bg-muted disabled:opacity-40"
                      >
                        Hoy
                      </button>
                    </div>
                  </td>
                  <td className="px-2 py-2 max-lg:col-span-2 max-lg:p-0">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:hidden">Consumo interno</span>
                    <input
                      disabled={lock}
                      aria-label={`Consumo interno de ${it.nombre}`}
                      className={`${fieldClass} w-[120px]! max-lg:w-full!`}
                      value={edicion.consumoInterno}
                      onChange={(e) =>
                        onCambiar(it, "consumoInterno", e.target.value)
                      }
                      onKeyDown={enter}
                      placeholder="Opcional"
                    />
                  </td>
                  <td className="whitespace-nowrap py-2 pl-2 pr-4 text-right max-lg:col-span-2 max-lg:p-0 max-lg:text-left empty:hidden">
                    {sucia || guardando[it.fila] || guardado[it.fila] ? (
                      <button
                        type="button"
                        onClick={() => void onGuardarLinea(it)}
                        disabled={!sucia || guardando[it.fila]}
                        title="Guardar esta fila (Enter)"
                        className="inline-flex h-9 min-w-[84px] items-center justify-center rounded-lg bg-accent px-3 text-xs font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-default disabled:bg-transparent disabled:text-success disabled:shadow-none"
                      >
                        {guardando[it.fila]
                          ? "Guardando…"
                          : guardado[it.fila] && !sucia
                            ? "Guardado ✓"
                            : "Guardar"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onModificar({ tipo: "linea", item: it })}
                      disabled={lock}
                      title="Corregir artículo, cantidad o comentario"
                      aria-label={`Corregir ${it.nombre}`}
                      className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
                      </svg>
                    </button>
                    {it.anulado && !bloqueado && (
                      <button
                        type="button"
                        onClick={() => void onReactivarLinea(it)}
                        title="Reactivar este artículo"
                        aria-label={`Reactivar ${it.nombre}`}
                        className="ml-1 inline-flex h-9 items-center rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-secondary transition-colors hover:bg-muted"
                      >
                        Reactivar
                      </button>
                    )}
                    {!it.anulado && vigentes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onAnularLinea(it)}
                        disabled={
                          lock ||
                          hayCambiosPendientes ||
                          (it.cantidadRecibida ?? 0) > 0 ||
                          Boolean(it.consumoInterno)
                        }
                        title={
                          hayCambiosPendientes
                            ? "Guarda o descarta los cambios pendientes para poder anular"
                            : (it.cantidadRecibida ?? 0) > 0 || it.consumoInterno
                              ? "Ya tiene recepción o consumo registrado: no se puede anular"
                              : "Anular este artículo (queda registrado con su motivo)"
                        }
                        aria-label={`Anular ${it.nombre}`}
                        className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <circle cx="12" cy="12" r="9" />
                          <path d="M5.6 5.6l12.8 12.8" />
                        </svg>
                      </button>
                    )}
                    {pedido.items.length > 1 && !it.anulado && (
                      <button
                        type="button"
                        onClick={() => onEliminar(it)}
                        disabled={lock || hayCambiosPendientes}
                        title={
                          hayCambiosPendientes
                            ? "Guarda o descarta los cambios pendientes para poder eliminar"
                            : "Eliminar este artículo del pedido"
                        }
                        aria-label={`Eliminar ${it.nombre} del pedido`}
                        className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    )}
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
                <tr
                  className={`border-b border-border/70 last:border-0 max-lg:block max-lg:px-3 max-lg:pb-3 ${fondoFila}`}
                >
                  <td colSpan={9} className="px-4 pb-2.5 pt-0 max-lg:block max-lg:p-0">
                    <p className="flex flex-wrap items-center gap-x-5 gap-y-0.5 rounded-md border border-border/60 bg-card/60 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                      <span>
                        Proveedor:{" "}
                        <span className={dato}>
                          {!it.ocAsociada
                            ? "En gestión"
                            : infoOC
                              ? infoOC.proveedor
                              : infoOC === null
                                ? "No encontrado"
                                : "Consultando…"}
                        </span>
                      </span>
                      <span>
                        OC: <span className={dato}>{it.ocAsociada || "En gestión"}</span>
                        {it.ocAsociada && (
                          <button
                            type="button"
                            className="ml-2 text-xs text-red-600 underline"
                            onClick={() => quitarOC(it)}
                          >
                            Quitar
                          </button>
                        )}
                      </span>
                      <span>
                        Fecha:{" "}
                        <span className={dato}>
                          {infoOC?.fecha ? infoOC.fecha.split("-").reverse().join("/") : ""}
                        </span>
                      </span>
                      <span>
                        Estado: <span className={dato}>{infoOC?.estado ?? ""}</span>
                      </span>
                    </p>
                  </td>
                </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {!bloqueado && (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          Tip: escribe la cantidad y presiona <Kbd>Enter</Kbd> para guardar la
          fila, o usa <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd> para guardar todos los
          cambios de una vez.
        </p>
      )}
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

function IconFilter() {
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
      <path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" />
    </svg>
  );
}

function IconChevron({ dir }: { dir: "left" | "right" }) {
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
      <path d={dir === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
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
