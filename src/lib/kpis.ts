/**
 * Cálculo de KPIs de Adquisiciones a partir de los pedidos de /api/pedidos.
 * Funciones puras (sin React ni fetch). Las reglas de estado y de «a tiempo»
 * replican las de GestionPedidosPanel: si cambian allá, cambiarlas aquí.
 */

export type PedidoKpi = {
  pedidoId: string;
  /** ISO de cuando se registró el pedido. */
  fecha: string;
  solicitante: string;
  area: string;
  centroNegocio: string;
  /** Fecha de entrega pedida, texto "DD-MM-AA". */
  fechaEntrega: string;
  urgente: boolean;
  estadoManual: "" | "cerrado" | "anulado";
  motivoEstado: string;
  items: {
    nombre: string;
    cantidad: number;
    cantidadRecibida: number | null;
    /** "YYYY-MM-DD" o "". */
    fechaRecepcionBodega: string;
    fechaEntregaSolicitante: string;
    /** Artículo anulado: no cuenta en cantidades, estado ni fechas. */
    anulado?: boolean;
  }[];
};

export type EstadoKpi = "pendiente" | "parcial" | "completo" | "cerrado" | "anulado";

const DIA = 864e5;

function dia(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function parseYMD(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const f = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(f.getTime()) ? null : f;
}

function parseEntrega(s: string): Date | null {
  const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (m) {
    const f = new Date(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return Number.isNaN(f.getTime()) ? null : f;
  }
  // Hay fechas que Sheets guardó como "AAAA-MM-DD" o como número de serie.
  const ymd = parseYMD(s);
  if (ymd) return ymd;
  if (/^\d{5}$/.test(s.trim())) return new Date(1899, 11, 30 + Number(s));
  return null;
}

/** La más tardía de las fechas de las líneas; null si a alguna le falta. */
function fechaTardia(valores: string[]): Date | null {
  if (valores.length === 0) return null;
  const fs = valores.map(parseYMD);
  if (fs.some((f) => f === null)) return null;
  return new Date(Math.max(...(fs as Date[]).map((f) => f.getTime())));
}

export type Derivado = {
  p: PedidoKpi;
  estado: EstadoKpi;
  creado: Date;
  /** Días de pedido a que la última línea llegó a bodega. */
  diasBodega: number | null;
  aTiempoBodega: boolean | null;
  aTiempoEntrega: boolean | null;
  pedida: number;
  recibida: number;
  atrasado: boolean;
  /** Fecha de entrega pedida, si se pudo interpretar. */
  prometida: Date | null;
  /** Días de atraso respecto de la fecha pedida (solo pedidos abiertos atrasados). */
  diasAtraso: number | null;
  edadDias: number;
};

function estadoDe(p: PedidoKpi): EstadoKpi {
  if (p.estadoManual) return p.estadoManual;
  if (p.items.length === 0 || p.items.every((i) => i.cantidadRecibida === null)) return "pendiente";
  return p.items.every((i) => i.cantidadRecibida !== null && i.cantidadRecibida >= i.cantidad)
    ? "completo"
    : "parcial";
}

export function derivar(pedido: PedidoKpi, hoy: Date = new Date()): Derivado | null {
  // Los artículos anulados se ignoran por completo.
  const p: PedidoKpi = pedido.items.some((i) => i.anulado)
    ? { ...pedido, items: pedido.items.filter((i) => !i.anulado) }
    : pedido;
  const f = new Date(p.fecha);
  if (Number.isNaN(f.getTime())) return null;
  const creado = new Date(f.getFullYear(), f.getMonth(), f.getDate());
  const estado = estadoDe(p);
  const prometida = parseEntrega(p.fechaEntrega);
  const bodega = fechaTardia(p.items.map((i) => i.fechaRecepcionBodega));
  const entrega = fechaTardia(p.items.map((i) => i.fechaEntregaSolicitante));
  const abierto = estado === "pendiente" || estado === "parcial";
  const diasBodega = bodega ? Math.round((dia(bodega) - dia(creado)) / DIA) : null;
  return {
    p,
    estado,
    creado,
    diasBodega: diasBodega !== null && diasBodega >= 0 ? diasBodega : null,
    aTiempoBodega: estado === "anulado" || !bodega || !prometida ? null : dia(bodega) <= dia(prometida),
    aTiempoEntrega: estado === "anulado" || !entrega || !prometida ? null : dia(entrega) <= dia(prometida),
    pedida: p.items.reduce((s, i) => s + i.cantidad, 0),
    recibida: p.items.reduce((s, i) => s + Math.min(i.cantidadRecibida ?? 0, i.cantidad), 0),
    atrasado: abierto && !!prometida && dia(prometida) < dia(hoy),
    prometida,
    diasAtraso:
      abierto && prometida && dia(prometida) < dia(hoy)
        ? Math.round((dia(hoy) - dia(prometida)) / DIA)
        : null,
    edadDias: Math.max(0, Math.round((dia(hoy) - dia(creado)) / DIA)),
  };
}

export function derivarTodos(pedidos: PedidoKpi[], hoy: Date = new Date()): Derivado[] {
  return pedidos.map((p) => derivar(p, hoy)).filter((d): d is Derivado => d !== null);
}

export function mediana(v: number[]): number | null {
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function percentil(v: number[], q: number): number | null {
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
}

/** Porcentaje de verdaderos entre los medibles (no null); null si no hay ninguno. */
function pct(v: (boolean | null)[]): { valor: number | null; n: number } {
  const med = v.filter((x): x is boolean => x !== null);
  return { valor: med.length ? (100 * med.filter(Boolean).length) / med.length : null, n: med.length };
}

export type Metricas = {
  creados: number;
  anulados: number;
  urgentes: number;
  diasBodegaMediana: number | null;
  diasBodegaP90: number | null;
  nBodega: number;
  aTiempoBodega: number | null;
  nATiempoBodega: number;
  aTiempoEntrega: number | null;
  nATiempoEntrega: number;
  /** Cantidad recibida / pedida en pedidos completos o cerrados. */
  cumplimientoCantidades: number | null;
  nCumplimiento: number;
  urgBodegaMediana: number | null;
  urgATiempoBodega: number | null;
  nUrgATiempo: number;
};

export function metricas(ds: Derivado[]): Metricas {
  const vivos = ds.filter((d) => d.estado !== "anulado");
  const dias = vivos.map((d) => d.diasBodega).filter((x): x is number => x !== null);
  const bodega = pct(vivos.map((d) => d.aTiempoBodega));
  const entrega = pct(vivos.map((d) => d.aTiempoEntrega));
  const cerrados = vivos.filter((d) => d.estado === "completo" || d.estado === "cerrado");
  const pedida = cerrados.reduce((s, d) => s + d.pedida, 0);
  const recibida = cerrados.reduce((s, d) => s + d.recibida, 0);
  const urg = vivos.filter((d) => d.p.urgente);
  const urgDias = urg.map((d) => d.diasBodega).filter((x): x is number => x !== null);
  const urgTiempo = pct(urg.map((d) => d.aTiempoBodega));
  return {
    creados: ds.length,
    anulados: ds.length - vivos.length,
    urgentes: urg.length,
    diasBodegaMediana: mediana(dias),
    diasBodegaP90: percentil(dias, 0.9),
    nBodega: dias.length,
    aTiempoBodega: bodega.valor,
    nATiempoBodega: bodega.n,
    aTiempoEntrega: entrega.valor,
    nATiempoEntrega: entrega.n,
    cumplimientoCantidades: pedida > 0 ? (100 * recibida) / pedida : null,
    nCumplimiento: cerrados.length,
    urgBodegaMediana: mediana(urgDias),
    urgATiempoBodega: urgTiempo.valor,
    nUrgATiempo: urgTiempo.n,
  };
}

export type Periodo = { desde: Date; hasta: Date };

export function enPeriodo(ds: Derivado[], { desde, hasta }: Periodo): Derivado[] {
  const a = dia(desde);
  const b = dia(hasta);
  return ds.filter((d) => dia(d.creado) >= a && dia(d.creado) <= b);
}

/** Período inmediatamente anterior y del mismo largo (para comparar). */
export function periodoAnterior({ desde, hasta }: Periodo): Periodo {
  const largo = Math.round((dia(hasta) - dia(desde)) / DIA) + 1;
  const h = new Date(dia(desde) - DIA);
  return { desde: new Date(dia(h) - (largo - 1) * DIA), hasta: h };
}

export type Backlog = {
  abiertos: number;
  atrasados: number;
  urgentesAbiertos: number;
  /** Antigüedad (desde que se pidió) de los pedidos abiertos. */
  edades: { label: string; n: number; pedidos: Derivado[] }[];
  /** Los pedidos detrás de cada número, para poder abrirlos. */
  lista: { abiertos: Derivado[]; atrasados: Derivado[]; urgentes: Derivado[] };
};

export function backlog(ds: Derivado[]): Backlog {
  const ab = ds.filter((d) => d.estado === "pendiente" || d.estado === "parcial");
  const tramos: [string, (e: number) => boolean][] = [
    ["0–7 días", (e) => e <= 7],
    ["8–15 días", (e) => e >= 8 && e <= 15],
    ["16–30 días", (e) => e >= 16 && e <= 30],
    ["Más de 30", (e) => e > 30],
  ];
  const atrasados = ab.filter((d) => d.atrasado);
  const urgentes = ab.filter((d) => d.p.urgente);
  return {
    abiertos: ab.length,
    atrasados: atrasados.length,
    urgentesAbiertos: urgentes.length,
    edades: tramos.map(([label, f]) => {
      const pedidos = ab.filter((d) => f(d.edadDias));
      return { label, n: pedidos.length, pedidos };
    }),
    lista: { abiertos: ab, atrasados, urgentes },
  };
}

export type PuntoMensual = {
  mes: string;
  creados: number;
  diasBodegaMediana: number | null;
  aTiempoBodega: number | null;
};

export function serieMensual(ds: Derivado[]): PuntoMensual[] {
  const porMes = new Map<string, Derivado[]>();
  for (const d of ds) {
    const k = `${d.creado.getFullYear()}-${String(d.creado.getMonth() + 1).padStart(2, "0")}`;
    porMes.set(k, [...(porMes.get(k) ?? []), d]);
  }
  return [...porMes.keys()].sort().map((mes) => {
    const m = metricas(porMes.get(mes)!);
    return { mes, creados: m.creados, diasBodegaMediana: m.diasBodegaMediana, aTiempoBodega: m.aTiempoBodega };
  });
}

export type FilaRanking = {
  clave: string;
  creados: number;
  diasBodegaMediana: number | null;
  aTiempoBodega: number | null;
  nATiempo: number;
  abiertos: number;
  atrasados: number;
  /** Todos los pedidos de la fila (para abrirlos al hacer clic). */
  pedidos: Derivado[];
};

export function ranking(ds: Derivado[], clave: (d: Derivado) => string, top = 8): FilaRanking[] {
  const g = new Map<string, Derivado[]>();
  for (const d of ds) {
    const k = clave(d).trim() || "(sin dato)";
    g.set(k, [...(g.get(k) ?? []), d]);
  }
  return [...g.entries()]
    .map(([k, v]) => {
      const m = metricas(v);
      const b = backlog(v);
      return {
        clave: k,
        creados: m.creados,
        diasBodegaMediana: m.diasBodegaMediana,
        aTiempoBodega: m.aTiempoBodega,
        nATiempo: m.nATiempoBodega,
        abiertos: b.abiertos,
        atrasados: b.atrasados,
        pedidos: v,
      };
    })
    .sort((a, b) => b.creados - a.creados || a.clave.localeCompare(b.clave))
    .slice(0, top);
}

export function motivosAnulacion(ds: Derivado[], top = 5): { motivo: string; n: number }[] {
  const c = new Map<string, number>();
  for (const d of ds) {
    if (d.estado !== "anulado") continue;
    const m = d.p.motivoEstado.trim() || "(sin motivo)";
    c.set(m, (c.get(m) ?? 0) + 1);
  }
  return [...c.entries()].map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n).slice(0, top);
}
