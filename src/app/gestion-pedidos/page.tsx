import { redirect } from "next/navigation";
import CerrarSesionButton from "@/components/CerrarSesionButton";
import GestionPedidosPanel from "@/components/GestionPedidosPanel";
import LoginGestion from "@/components/LoginGestion";
import { getPerfil, perfilLabel } from "@/lib/auth";

export const metadata = {
  title: "Gestión de Pedidos | Centralización Adquisiciones",
};

// Depende de la cookie de sesión, así que nunca se sirve prerenderizada.
export const dynamic = "force-dynamic";

export default async function GestionPedidosPage() {
  const perfil = await getPerfil();
  if (!perfil) {
    return (
      <div className="py-8">
        <LoginGestion usuarioInicial="adquisiciones" />
      </div>
    );
  }
  // Supervisor y Maestro solo consultan: van a su vista.
  if (perfil !== "adquisiciones") redirect("/mis-pedidos");

  return (
    <div className="mx-auto w-full max-w-[1800px]">
      <header className="mb-3 flex items-center justify-between gap-4">
        <h1 className="text-xl font-extrabold tracking-tight text-primary">
          Gestión de Pedidos
        </h1>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Sesión: {perfilLabel(perfil)}
          </span>
          <CerrarSesionButton />
        </div>
      </header>
      <GestionPedidosPanel />
    </div>
  );
}
