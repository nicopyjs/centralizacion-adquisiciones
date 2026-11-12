"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  backlog,
  derivarTodos,
  enPeriodo,
  metricas,
  motivosAnulacion,
  periodoAnterior,
  ranking,
  serieMensual,
  type Derivado,
  type FilaRanking,
  type PedidoKpi,
  type Periodo,
} from "@/lib/kpis";

type PeriodoClave = "mes" | "30" | "90" | "todo";

const PERIODOS: { clave: PeriodoClave; label: string }[] = [
  { clave: "mes", label: "Este mes" },
  { clave: "30", label: "30 días" },
  { clave: "90", label: "90 días" },
  { clave: "todo", label: "Todo" },
];

const cardClass = "rounded-xl border border-border bg-card shadow-sm";
// Pocos pedidos medidos: el porcentaje se mueve mucho con uno solo.
const MIN_MUESTRA = 10;
// Bajo este % de urgentes a tiempo la tarjeta se marca como advertencia.
const META_URGENTES = 80;
/** ¿Alguno de los dos períodos tiene muy pocos pedidos medidos? */
const chica = (a: number, b: number) => a < MIN_MUESTRA || b < MIN_MUESTRA;

function periodoDe(clave: PeriodoClave): Periodo | null {
  const hoy = new Date();
  const h = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  if (clave === "mes") return { desde: new Date(h.getFullYear(), h.getMonth(), 1), hasta: h };
  if (clave === "todo") return null;
  const dias = Number(clave);
  return { desde: new Date(h.getFullYear(), h.getMonth(), h.getDate() - (dias - 1)), hasta: h };
}

const num = (n: number, dec = 0) =>
  n.toLocaleString("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: dec });
const dias = (n: number | null) => (n === null ? "—" : `${num(n, 1)} d`);
const porc = (n: number | null) => (n === null ? "—" : `${num(n)}%`);

function Delta({
  actual,
  previo,
  menorMejor = false,
  neutro = false,
  apagado = false,
  unidad = "",
  dec = 0,
}: {
  actual: number | null;
  previo: number | null;
  menorMejor?: boolean;
  /** Para volúmenes: subir o bajar no es bueno ni malo. */
  neutro?: boolean;
  /** Muestra muy chica en alguno de los dos períodos: se ve en gris, sin juicio. */
  apagado?: boolean;
  unidad?: string;
  dec?: number;
}) {
  if (actual === null || previo === null) return null;
  const d = actual - previo;
  if (Math.abs(d) < 0.05) {
    return <span className="text-[11px] font-semibold text-muted-foreground">= sin cambio</span>;
  }
  const mejor = menorMejor ? d < 0 : d > 0;
  const color =
    apagado || neutro ? "text-muted-foreground" : mejor ? "text-success" : "text-destructive";
  return (
    <span
      className={`text-[11px] font-semibold ${color}`}
      title={apagado ? "Pocos pedidos medidos: la variación no es confiable." : undefined}
    >
      {d > 0 ? "▲" : "▼"} {num(Math.abs(d), dec)}
      {unidad} <span className="font-medium text-muted-foreground">vs anterior</span>
    </span>
  );
}

function Tile({
  titulo,
  valor,
  sub,
  n,
  ayuda,
  delta,
  alerta,
}: {
  titulo: string;
  valor: string;
  sub?: string;
  n?: number;
  ayuda: string;
  delta?: ReactNode;
  /** Texto de advertencia: pinta la tarjeta para que no pase desapercibida. */
  alerta?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-xl border border-t-[3px] p-4 shadow-sm ${
        alerta ? "border-warning/50 border-t-warning bg-warning-surface" : "border-border border-t-brand bg-card"
      }`}
      title={ayuda}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </div>
      <div className="text-3xl font-extrabold tracking-tight text-primary">{valor}</div>
      {alerta && <div className="text-[11px] font-bold text-warning">⚠ {alerta}</div>}
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 pt-1">
        {delta ?? <span />}
        {n !== undefined && (
          <span
            className={`text-[11px] ${n < MIN_MUESTRA ? "font-semibold text-warning" : "text-muted-foreground"}`}
          >
            {n === 0 ? "sin datos" : `n = ${n}${n < MIN_MUESTRA ? " · pocos datos" : ""}`}
          </span>
        )}
      </div>
    </div>
  );
}

function Seccion({
  titulo,
  nota,
  className = "",
  children,
}: {
  titulo: string;
  nota?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`${cardClass} p-4 ${className}`}>
      <div className="mb-3 flex items-start gap-2">
        <span aria-hidden className="mt-0.5 h-4 w-1 shrink-0 rounded-full bg-brand" />
        <div>
          <h2 className="text-sm font-extrabold tracking-tight text-primary">{titulo}</h2>
          {nota && <p className="text-xs text-muted-foreground">{nota}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Barras verticales simples (una serie, un tono). `max` fija la escala. */
function BarrasMes({
  datos,
  max,
  formato,
}: {
  datos: { mes: string; valor: number | null; detalle: string }[];
  max: number;
  formato: (n: number) => string;
}) {
  return (
    <div className="flex h-32 items-end justify-center gap-3">
      {datos.map((d, i) => {
        const [y, m] = d.mes.split("-").map(Number);
        const label = new Date(y, m - 1, 1).toLocaleDateString("es-CL", { month: "short", year: "2-digit" });
        const alto = d.valor === null ? 0 : Math.max(2, (d.valor / max) * 100);
        // El mes más reciente va en amarillo NEB; los anteriores en gris azulado.
        const actual = i === datos.length - 1;
        return (
          <div key={d.mes} className="flex h-full w-full max-w-16 flex-col items-center justify-end gap-1" title={d.detalle}>
            <span className="text-xs font-bold text-primary">{d.valor === null ? "—" : formato(d.valor)}</span>
            <div className="relative w-full flex-1">
              <div
                className={`absolute inset-x-0 bottom-0 rounded-t ${actual ? "bg-brand" : "bg-secondary/30"}`}
                style={{ height: `${alto}%` }}
              />
            </div>
            <span className={`text-[11px] ${actual ? "font-bold text-primary" : "text-muted-foreground"}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function TablaRanking({ titulo, filas }: { titulo: string; filas: FilaRanking[] }) {
  const max = Math.max(1, ...filas.map((f) => f.creados));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="py-1.5 pr-2 font-semibold">{titulo}</th>
            <th className="px-2 py-1.5 text-right font-semibold">Pedidos</th>
            <th className="px-2 py-1.5 text-right font-semibold">A bodega</th>
            <th className="px-2 py-1.5 text-right font-semibold">A tiempo</th>
            <th className="px-2 py-1.5 text-right font-semibold">Abiertos</th>
            <th className="py-1.5 pl-2 text-right font-semibold">Atrasados</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave} className="border-b border-border/60 last:border-0">
              <td className="max-w-[260px] py-1.5 pr-2">
                <div className="truncate font-medium text-card-foreground" title={f.clave}>
                  {f.clave}
                </div>
                <div className="mt-0.5 h-1 rounded-full bg-muted">
                  <div className="h-1 rounded-full bg-primary/70" style={{ width: `${(f.creados / max) * 100}%` }} />
                </div>
              </td>
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{f.creados}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{dias(f.diasBodegaMediana)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {porc(f.aTiempoBodega)}
                {f.nATiempo > 0 && f.nATiempo < 5 && (
                  <span className="ml-1 text-[10px] text-warning" title={`Solo ${f.nATiempo} pedidos medidos`}>
                    n={f.nATiempo}
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{f.abiertos}</td>
              <td
                className={`py-1.5 pl-2 text-right font-semibold tabular-nums ${f.atrasados > 0 ? "text-destructive" : "text-muted-foreground"}`}
              >
                {f.atrasados}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function KpisPanel() {
  const [pedidos, setPedidos] = useState<PedidoKpi[] | null>(null);
  const [error, setError] = useState("");
  const [periodo, setPeriodo] = useState<PeriodoClave>("mes");
  const [area, setArea] = useState("");

  useEffect(() => {
    let cancelado = false;
    fetch("/api/pedidos", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error ?? "No se pudieron cargar los pedidos.");
        return d.pedidos as PedidoKpi[];
      })
      .then((p) => {
        if (!cancelado) setPedidos(p);
      })
      .catch((e: unknown) => {
        if (!cancelado) setError(e instanceof Error ? e.message : "Error al cargar.");
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const todos = useMemo(() => derivarTodos(pedidos ?? []), [pedidos]);
  const areas = useMemo(
    () => [...new Set(todos.map((d) => d.p.area.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [todos]
  );
  const delArea = useMemo(
    () => (area ? todos.filter((d) => d.p.area.trim() === area) : todos),
    [todos, area]
  );

  const per = useMemo(() => periodoDe(periodo), [periodo]);
  const actual: Derivado[] = useMemo(() => (per ? enPeriodo(delArea, per) : delArea), [delArea, per]);
  // «Este mes» se compara con los mismos días del mes anterior (no con los
  // 12 días previos, que cruzan de mes); el resto, con el tramo anterior del mismo largo.
  const previoPer = useMemo<Periodo | null>(() => {
    if (!per) return null;
    if (periodo !== "mes") return periodoAnterior(per);
    const y = per.hasta.getFullYear();
    const mes = per.hasta.getMonth();
    const diasMesPrevio = new Date(y, mes, 0).getDate();
    return {
      desde: new Date(y, mes - 1, 1),
      hasta: new Date(y, mes - 1, Math.min(per.hasta.getDate(), diasMesPrevio)),
    };
  }, [per, periodo]);
  // Sin variación si el período anterior empieza antes del primer pedido
  // registrado: compararía contra un tramo incompleto.
  const primerPedido = useMemo(
    () => (todos.length ? Math.min(...todos.map((d) => d.creado.getTime())) : null),
    [todos]
  );
  const previo: Derivado[] | null = useMemo(
    () =>
      previoPer && primerPedido !== null && previoPer.desde.getTime() >= primerPedido
        ? enPeriodo(delArea, previoPer)
        : null,
    [delArea, previoPer, primerPedido]
  );

  const m = useMemo(() => metricas(actual), [actual]);
  const mp = useMemo(() => (previo ? metricas(previo) : null), [previo]);
  const bk = useMemo(() => backlog(delArea), [delArea]);
  const mensual = useMemo(() => serieMensual(delArea), [delArea]);
  const motivos = useMemo(() => motivosAnulacion(actual), [actual]);
  const porArea = useMemo(() => ranking(actual, (d) => d.p.area, 6), [actual]);
  const porCentro = useMemo(() => ranking(actual, (d) => d.p.centroNegocio, 8), [actual]);
  const porSolicitante = useMemo(() => ranking(actual, (d) => d.p.solicitante, 8), [actual]);

  if (error) {
    return <div className={`${cardClass} p-6 text-sm text-destructive`}>{error}</div>;
  }
  if (!pedidos) {
    return <div className={`${cardClass} p-6 text-sm text-muted-foreground`}>Calculando KPIs…</div>;
  }

  const maxEdad = Math.max(1, ...bk.edades.map((e) => e.n));
  const maxMes = Math.max(1, ...mensual.map((p) => p.creados));
  const pctAnulados = m.creados > 0 ? (100 * m.anulados) / m.creados : null;
  const pctUrgentes = m.creados - m.anulados > 0 ? (100 * m.urgentes) / (m.creados - m.anulados) : null;

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shadow-sm" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button
              key={p.clave}
              type="button"
              onClick={() => setPeriodo(p.clave)}
              aria-pressed={periodo === p.clave}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                periodo === p.clave ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-primary"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select
          value={area}
          onChange={(e) => setArea(e.target.value)}
          aria-label="Filtrar por área"
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm shadow-sm"
        >
          <option value="">Todas las áreas</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {m.creados} pedidos creados en el período
          {!per
            ? ""
            : previo
              ? periodo === "mes"
                ? " · comparado con los mismos días del mes anterior"
                : " · comparado con el período anterior del mismo largo"
              : " · sin comparación: no hay datos completos del período anterior"}
        </span>
      </div>

      {/* KPIs del período */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Tile
          titulo="Pedidos creados"
          valor={num(m.creados)}
          sub={`${m.urgentes} urgentes${pctUrgentes !== null ? ` (${num(pctUrgentes)}%)` : ""}`}
          ayuda="Pedidos registrados en el período (incluye anulados)."
          delta={mp && <Delta actual={m.creados} previo={mp.creados} neutro />}
        />
        <Tile
          titulo="Tiempo a bodega"
          valor={dias(m.diasBodegaMediana)}
          sub={`mediana · el 90% llega en ${dias(m.diasBodegaP90)} o menos`}
          n={m.nBodega}
          ayuda="Días desde que se registra el pedido hasta que su última línea llega a bodega. Solo pedidos con todas las líneas ya recibidas."
          delta={
            mp && (
              <Delta
                actual={m.diasBodegaMediana}
                previo={mp.diasBodegaMediana}
                menorMejor
                unidad=" d"
                dec={1}
                apagado={chica(m.nBodega, mp.nBodega)}
              />
            )
          }
        />
        <Tile
          titulo="Llegó a bodega a tiempo"
          valor={porc(m.aTiempoBodega)}
          sub="recepción en bodega ≤ fecha de entrega pedida"
          n={m.nATiempoBodega}
          ayuda="Pedidos cuya última línea llegó a bodega a más tardar en la fecha de entrega pedida."
          delta={
            mp && (
              <Delta
                actual={m.aTiempoBodega}
                previo={mp.aTiempoBodega}
                unidad=" pp"
                apagado={chica(m.nATiempoBodega, mp.nATiempoBodega)}
              />
            )
          }
        />
        <Tile
          titulo="Entregado al solicitante a tiempo"
          valor={porc(m.aTiempoEntrega)}
          sub="entrega al solicitante ≤ fecha de entrega pedida"
          n={m.nATiempoEntrega}
          ayuda="Pedidos con la fecha de entrega al solicitante registrada en todas sus líneas."
          delta={
            mp && (
              <Delta
                actual={m.aTiempoEntrega}
                previo={mp.aTiempoEntrega}
                unidad=" pp"
                apagado={chica(m.nATiempoEntrega, mp.nATiempoEntrega)}
              />
            )
          }
        />
        <Tile
          titulo="Urgentes a tiempo"
          valor={porc(m.urgATiempoBodega)}
          sub={`mediana a bodega: ${dias(m.urgBodegaMediana)} · todos: ${porc(m.aTiempoBodega)}`}
          n={m.nUrgATiempo}
          alerta={
            m.urgATiempoBodega !== null && m.nUrgATiempo >= MIN_MUESTRA && m.urgATiempoBodega < META_URGENTES
              ? `bajo la meta de ${META_URGENTES}%`
              : undefined
          }
          ayuda="Lo mismo que «Llegó a bodega a tiempo», solo para pedidos marcados como urgentes."
          delta={
            mp && (
              <Delta
                actual={m.urgATiempoBodega}
                previo={mp.urgATiempoBodega}
                unidad=" pp"
                apagado={chica(m.nUrgATiempo, mp.nUrgATiempo)}
              />
            )
          }
        />
        <Tile
          titulo="Cantidades cumplidas"
          valor={porc(m.cumplimientoCantidades)}
          sub="recibido ÷ pedido, en pedidos completos o cerrados"
          n={m.nCumplimiento}
          ayuda="Qué parte de lo pedido se recibió en los pedidos ya terminados. Baja si se cierran pedidos con faltantes."
          delta={
            mp && (
              <Delta
                actual={m.cumplimientoCantidades}
                previo={mp.cumplimientoCantidades}
                unidad=" pp"
                apagado={chica(m.nCumplimiento, mp.nCumplimiento)}
              />
            )
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Estado actual */}
        <Seccion
          titulo="Pendientes hoy"
          nota="Foto actual de los pedidos sin recibir por completo; no depende del período."
          className="lg:col-span-2"
        >
          <div className="mb-4 grid grid-cols-3 gap-3">
            {[
              ["Abiertos", bk.abiertos, "text-primary"],
              ["Atrasados", bk.atrasados, bk.atrasados > 0 ? "text-destructive" : "text-primary"],
              ["Urgentes", bk.urgentesAbiertos, "text-primary"],
            ].map(([t, v, c]) => (
              <div key={t as string}>
                <div className={`text-2xl font-extrabold ${c}`}>{v as number}</div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t as string}</div>
              </div>
            ))}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Antigüedad de los abiertos
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {bk.edades.map((e) => (
              <li key={e.label} className="flex items-center gap-2 text-xs" title={`${e.n} pedidos abiertos`}>
                <span className="w-20 shrink-0 text-muted-foreground">{e.label}</span>
                <div className="h-3 flex-1 rounded bg-muted">
                  <div className="h-3 rounded bg-primary/70" style={{ width: `${(e.n / maxEdad) * 100}%` }} />
                </div>
                <span className="w-6 text-right font-semibold tabular-nums">{e.n}</span>
              </li>
            ))}
          </ul>
        </Seccion>

        {/* Anulaciones */}
        <Seccion titulo="Anulaciones" nota="Pedidos anulados dentro del período.">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-primary">{m.anulados}</span>
            <span className="text-xs text-muted-foreground">{pctAnulados !== null ? `${num(pctAnulados, 1)}% de los creados` : ""}</span>
          </div>
          {motivos.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin anulaciones en este período.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {motivos.map((x) => (
                <li key={x.motivo} className="flex items-start justify-between gap-3">
                  <span className="text-card-foreground">{x.motivo}</span>
                  <span className="font-semibold tabular-nums">{x.n}</span>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      </div>

      {/* Tendencia */}
      {mensual.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Seccion titulo="Pedidos por mes">
            <BarrasMes
              datos={mensual.map((p) => ({ mes: p.mes, valor: p.creados, detalle: `${p.creados} pedidos` }))}
              max={maxMes}
              formato={(n) => num(n)}
            />
          </Seccion>
          <Seccion titulo="Tiempo a bodega por mes" nota="Mediana, en días.">
            <BarrasMes
              datos={mensual.map((p) => ({
                mes: p.mes,
                valor: p.diasBodegaMediana,
                detalle: p.diasBodegaMediana === null ? "Sin datos" : `Mediana ${num(p.diasBodegaMediana, 1)} días`,
              }))}
              max={Math.max(1, ...mensual.map((p) => p.diasBodegaMediana ?? 0))}
              formato={(n) => num(n, 1)}
            />
          </Seccion>
          <Seccion titulo="A tiempo en bodega por mes" nota="% de pedidos medidos.">
            <BarrasMes
              datos={mensual.map((p) => ({
                mes: p.mes,
                valor: p.aTiempoBodega,
                detalle: p.aTiempoBodega === null ? "Sin datos" : `${num(p.aTiempoBodega)}% a tiempo`,
              }))}
              max={100}
              formato={(n) => `${num(n)}%`}
            />
          </Seccion>
        </div>
      )}

      {/* Rankings */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Seccion titulo="Por área" nota="Ordenado por cantidad de pedidos del período.">
          <TablaRanking titulo="Área" filas={porArea} />
        </Seccion>
        <Seccion titulo="Por centro de negocio" nota="Los 8 con más pedidos.">
          <TablaRanking titulo="Centro" filas={porCentro} />
        </Seccion>
        <Seccion titulo="Por solicitante" nota="Los 8 con más pedidos.">
          <TablaRanking titulo="Solicitante" filas={porSolicitante} />
        </Seccion>
        <Seccion titulo="Cómo leer estos números">
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
            <li>Los tiempos y porcentajes «a tiempo» solo consideran pedidos con todas sus líneas ya recibidas y fecha de entrega pedida; <b>n</b> indica cuántos.</li>
            <li>El pedido cuenta en el mes en que se registró, aunque se haya recibido después.</li>
            <li>La fecha de llegada a bodega y la de entrega al solicitante se autocompletan con el día en que se registran en el panel: si se anotan tarde, el tiempo se ve mayor o menor al real.</li>
            <li>Los pedidos anulados no entran en tiempos ni porcentajes.</li>
            <li>Con menos de {MIN_MUESTRA} pedidos medidos, un solo pedido mueve el porcentaje varios puntos.</li>
          </ul>
        </Seccion>
      </div>
    </div>
  );
}
