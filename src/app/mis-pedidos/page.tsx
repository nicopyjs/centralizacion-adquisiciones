import { redirect } from "next/navigation";
import CerrarSesionButton from "@/components/CerrarSesionButton";
import LoginGestion from "@/components/LoginGestion";
import MisPedidosPanel from "@/components/MisPedidosPanel";
import { areaLabel, getSesion, perfilLabel } from "@/lib/auth";

export const metadata = {
  title: "Mis Pedidos | Centralización Adquisiciones",
};

// Depende de la cookie de sesión, así que nunca se sirve prerenderizada.
export const dynamic = "force-dynamic";

export default async function MisPedidosPage() {
  const sesion = await getSesion();
  if (!sesion) {
    return (
      <div className="py-8">
        <LoginGestion areaInicial="refacciones" />
      </div>
    );
  }
  // Adquisiciones trabaja en Gestión de Pedidos.
  if (sesion.perfil === "adquisiciones" || !sesion.area) redirect("/gestion-pedidos");

  const area = areaLabel(sesion.area);

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-primary">
            Pedidos de {area}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Revisa el estado de los pedidos de tu área, de solo lectura.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Sesión: {perfilLabel(sesion.perfil)} · {area}
          </span>
          <CerrarSesionButton />
        </div>
      </header>
      <MisPedidosPanel />
    </div>
  );
}
