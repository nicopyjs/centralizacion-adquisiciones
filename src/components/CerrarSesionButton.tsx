"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CerrarSesionButton() {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    setSaliendo(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={salir}
      disabled={saliendo}
      className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-muted disabled:opacity-50"
    >
      Cerrar sesión
    </button>
  );
}
