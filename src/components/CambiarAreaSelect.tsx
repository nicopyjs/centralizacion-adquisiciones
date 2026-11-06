"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const NOMBRES: Record<string, string> = {
  refacciones: "Refacciones",
  "servicio-tecnico": "Servicio Técnico",
  instalaciones: "Instalaciones",
  "transicion-postventa": "Transición y Postventa",
};
const ADQ = "adquisiciones";

/**
 * Cambia de vista con la cuenta Google: supervisores con varias áreas eligen
 * entre las suyas; el admin además puede pasar a Gestión de Pedidos.
 */
export default function CambiarAreaSelect({ actual }: { actual: string }) {
  const router = useRouter();
  const [areas, setAreas] = useState<string[]>([]);
  const [admin, setAdmin] = useState(false);
  const [cambiando, setCambiando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelado) return;
        setAreas(d?.areasPermitidas ?? []);
        setAdmin(Boolean(d?.admin));
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, []);

  if (areas.length < 2 && !admin) return null;

  async function cambiar(destino: string) {
    setCambiando(true);
    try {
      await fetch("/api/auth/area", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area: destino }),
      });
    } finally {
      if (destino === ADQ) router.push("/gestion-pedidos");
      else router.refresh();
      setCambiando(false);
    }
  }

  // El admin tiene todas las áreas en la lista; para Adquisiciones se muestra
  // solo la opción de Gestión.
  const opciones = actual === ADQ ? [] : areas;

  return (
    <select
      aria-label="Cambiar de vista"
      value={actual}
      disabled={cambiando}
      onChange={(e) => void cambiar(e.target.value)}
      className="h-9 max-w-full rounded-lg border border-border bg-card px-2 text-sm font-semibold text-primary shadow-sm disabled:opacity-50"
    >
      {actual === ADQ &&
        areas.map((a) => (
          <option key={a} value={a}>
            Ver como supervisor · {NOMBRES[a] ?? a}
          </option>
        ))}
      {opciones.map((a) => (
        <option key={a} value={a}>
          {NOMBRES[a] ?? a}
        </option>
      ))}
      {admin && <option value={ADQ}>Adquisiciones (todas)</option>}
    </select>
  );
}
