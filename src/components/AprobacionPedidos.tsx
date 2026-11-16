"use client";

import { useCallback, useEffect, useState } from "react";
import type { PedidoPorAprobar } from "@/app/api/pedidos/aprobacion/route";

const botonPrimario =
  "inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";
const botonSecundario =
  "inline-flex h-10 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

function formatFecha(s: string): string {
  if (!s) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

type Edicion = { cantidad: string; quitar: boolean };

function Tarjeta({
  pedido,
  onResuelto,
  destacado,
}: {
  pedido: PedidoPorAprobar;
  onResuelto: (aprobado: boolean) => void;
  destacado: boolean;
}) {
  const [ediciones, setEdiciones] = useState<Record<number, Edicion>>(() =>
    Object.fromEntries(
      pedido.items.map((it) => [it.fila, { cantidad: String(it.cantidad), quitar: false }])
    )
  );
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quedan = pedido.items.filter((it) => !ediciones[it.fila]?.quitar).length;
  const cantidadesInvalidas = pedido.items.some((it) => {
    const e = ediciones[it.fila];
    return !e.quitar && !(Number(e.cantidad) > 0);
  });
  const hayCambios = pedido.items.some((it) => {
    const e = ediciones[it.fila];
    return e.quitar || Number(e.cantidad) !== it.cantidad;
  });

  async function enviar(accion: "aprobar" | "rechazar") {
    setTrabajando(true);
    setError(null);
    try {
      const res = await fetch("/api/pedidos/aprobacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion,
          pedidoId: pedido.pedidoId,
          motivo: motivo.trim(),
          lineas:
            accion === "aprobar"
              ? pedido.items.map((it) => ({
                  fila: it.fila,
                  cantidad: Number(ediciones[it.fila].cantidad),
                  quitar: ediciones[it.fila].quitar,
                }))
              : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo completar la acción.");
      onResuelto(accion === "aprobar");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red.");
      setTrabajando(false);
    }
  }

  return (
    <article
      id={`aprobacion-${pedido.pedidoId}`}
      className={`scroll-mt-4 rounded-xl border bg-card p-4 shadow-sm ${
        destacado ? "border-primary ring-2 ring-primary/40" : "border-border"
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-extrabold text-primary">
            {pedido.pedidoId}
            {pedido.urgente && (
              <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-bold uppercase text-destructive">
                Urgente
              </span>
            )}
            {pedido.estado === "rechazado" && (
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold uppercase text-muted-foreground">
                Rechazado
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pedido.solicitante} · {pedido.centroNegocio} · pedido el{" "}
            {formatFecha(pedido.fecha.slice(0, 10))}
          </p>
          <p className="text-xs text-muted-foreground">
            Entrega solicitada: {formatFecha(pedido.fechaEntrega)}
            {pedido.despacho ? ` · ${pedido.despacho}` : ""}
          </p>
        </div>
      </header>

      {pedido.estado === "rechazado" && pedido.motivoRechazo && (
        <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm text-card-foreground/80">
          <strong>Motivo del rechazo:</strong> {pedido.motivoRechazo}
        </p>
      )}
      {pedido.comentario && (
        <p className="mt-2 text-sm text-card-foreground/80">
          <strong>Comentario:</strong> {pedido.comentario}
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1 pr-3 font-semibold">Artículo</th>
              <th className="py-1 pr-3 font-semibold">Cantidad</th>
              <th className="py-1 font-semibold">Quitar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pedido.items.map((it) => {
              const e = ediciones[it.fila];
              return (
                <tr key={it.fila} className={e.quitar ? "opacity-50" : undefined}>
                  <td className="py-1.5 pr-3">
                    <span className={e.quitar ? "line-through" : undefined}>
                      <span className="font-mono text-xs text-muted-foreground">
                        {it.codigo}
                      </span>{" "}
                      {it.nombre}
                    </span>
                    {it.comentarioArticulo && (
                      <span className="block text-xs text-muted-foreground">
                        {it.comentarioArticulo}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={e.cantidad}
                      disabled={e.quitar || trabajando}
                      onChange={(ev) =>
                        setEdiciones((prev) => ({
                          ...prev,
                          [it.fila]: { ...prev[it.fila], cantidad: ev.target.value },
                        }))
                      }
                      aria-label={`Cantidad de ${it.nombre}`}
                      className="h-9 w-24 rounded-lg border border-border bg-card px-2 text-sm"
                    />{" "}
                    <span className="text-xs text-muted-foreground">{it.unidad}</span>
                  </td>
                  <td className="py-1.5">
                    <input
                      type="checkbox"
                      checked={e.quitar}
                      disabled={trabajando}
                      onChange={(ev) =>
                        setEdiciones((prev) => ({
                          ...prev,
                          [it.fila]: { ...prev[it.fila], quitar: ev.target.checked },
                        }))
                      }
                      aria-label={`Quitar ${it.nombre}`}
                      className="h-4 w-4"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rechazando && (
        <div className="mt-3">
          <label
            htmlFor={`motivo-${pedido.pedidoId}`}
            className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Motivo del rechazo <span className="text-destructive">*</span>
          </label>
          <textarea
            id={`motivo-${pedido.pedidoId}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            placeholder="Qué debe corregir el maestro"
          />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-destructive">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {rechazando ? (
          <>
            <button
              type="button"
              className={botonPrimario}
              disabled={trabajando || !motivo.trim()}
              onClick={() => enviar("rechazar")}
            >
              {trabajando ? "Rechazando…" : "Confirmar rechazo"}
            </button>
            <button
              type="button"
              className={botonSecundario}
              disabled={trabajando}
              onClick={() => setRechazando(false)}
            >
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={botonPrimario}
              disabled={trabajando || quedan === 0 || cantidadesInvalidas}
              onClick={() => enviar("aprobar")}
            >
              {trabajando
                ? "Aprobando…"
                : hayCambios
                  ? "Aprobar con cambios"
                  : "Aprobar"}
            </button>
            {pedido.estado === "pendiente" && (
              <button
                type="button"
                className={botonSecundario}
                disabled={trabajando}
                onClick={() => setRechazando(true)}
              >
                Rechazar
              </button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

/**
 * Pedidos de maestros que esperan la aprobación del supervisor (y los que ya
 * se rechazaron, por si hay que reconsiderarlos). Aprobar los deja visibles
 * para Adquisiciones. Sin pedidos por revisar no muestra nada.
 */
export default function AprobacionPedidos({ pedidoInicial }: { pedidoInicial?: string }) {
  const [pedidos, setPedidos] = useState<PedidoPorAprobar[]>([]);

  const cargar = useCallback(() => {
    fetch("/api/pedidos/aprobacion", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPedidos(d?.pedidos ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Desde el correo (?pedido=): lleva a la tarjeta de ese pedido.
  useEffect(() => {
    if (!pedidoInicial || !pedidos.some((p) => p.pedidoId === pedidoInicial)) return;
    document
      .getElementById(`aprobacion-${pedidoInicial}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pedidoInicial, pedidos]);

  const pendientes = pedidos.filter((p) => p.estado === "pendiente");
  const rechazados = pedidos.filter((p) => p.estado === "rechazado");
  if (pedidos.length === 0) return null;

  function resuelto(aprobado: boolean) {
    // Un pedido aprobado pasa a la lista de abajo: se recarga todo.
    if (aprobado) window.location.reload();
    else cargar();
  }

  return (
    <section aria-label="Pedidos por aprobar" className="mb-6 space-y-3">
      {pendientes.length > 0 && (
        <>
          <div className="rounded-xl border border-warning/40 bg-warning-surface px-4 py-3">
            <h2 className="text-base font-extrabold text-warning">
              {pendientes.length}{" "}
              {pendientes.length === 1 ? "pedido espera" : "pedidos esperan"} tu aprobación
            </h2>
            <p className="text-sm text-card-foreground/80">
              Pedidos de maestros. Adquisiciones los ve recién cuando los apruebas;
              puedes ajustar cantidades o quitar artículos antes.
            </p>
          </div>
          {pendientes.map((p) => (
            <Tarjeta key={p.pedidoId} pedido={p} onResuelto={resuelto} destacado={p.pedidoId === pedidoInicial} />
          ))}
        </>
      )}
      {rechazados.length > 0 && (
        <details className="rounded-xl border border-border bg-card p-3">
          <summary className="cursor-pointer text-sm font-semibold text-primary">
            Rechazados ({rechazados.length})
          </summary>
          <div className="mt-3 space-y-3">
            {rechazados.map((p) => (
              <Tarjeta key={p.pedidoId} pedido={p} onResuelto={resuelto} destacado={p.pedidoId === pedidoInicial} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
