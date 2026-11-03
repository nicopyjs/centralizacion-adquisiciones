"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const AREAS = [
  { id: "refacciones", label: "Refacciones" },
  { id: "servicio-tecnico", label: "Servicio Técnico" },
  { id: "instalaciones", label: "Instalaciones" },
  { id: "transicion-postventa", label: "Transición y Postventa" },
];

/** Tarjeta para que el admin elija en qué vista quiere trabajar. */
export default function CambiarVistaAdmin({
  destino,
}: {
  destino: "adquisiciones" | "area";
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);

  async function ir(area: string) {
    setEnviando(true);
    try {
      await fetch("/api/auth/area", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area }),
      });
    } finally {
      router.refresh();
      setEnviando(false);
    }
  }

  const boton =
    "inline-flex h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50";

  return (
    <div className="mx-auto mt-8 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-extrabold tracking-tight text-primary">
        Vista de administrador
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {destino === "adquisiciones"
          ? "Estás viendo un área como supervisor. Cambia a Adquisiciones para gestionar todos los pedidos."
          : "Estás en la vista de Adquisiciones. Elige el área que quieres ver como supervisor."}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {destino === "adquisiciones" ? (
          <button
            type="button"
            disabled={enviando}
            onClick={() => void ir("adquisiciones")}
            className={boton}
          >
            Ir a Gestión de Pedidos
          </button>
        ) : (
          AREAS.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={enviando}
              onClick={() => void ir(a.id)}
              className={boton}
            >
              {a.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
