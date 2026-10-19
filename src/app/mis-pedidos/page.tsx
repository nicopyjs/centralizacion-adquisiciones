import { redirect } from "next/navigation";
import CerrarSesionButton from "@/components/CerrarSesionButton";
import LoginGestion from "@/components/LoginGestion";
import MisPedidosPanel from "@/components/MisPedidosPanel";
import { getPerfil, perfilLabel } from "@/lib/auth";

export const metadata = {
  title: "Mis Pedidos | Centralización Adquisiciones",
};

// Depende de la cookie de sesión, así que nunca se sirve prerenderizada.
export const dynamic = "force-dynamic";

export default async function MisPedidosPage() {
  const perfil = await getPerfil();
  if (!perfil) {
    return (
      <div className="py-8">
        <LoginGestion usuarioInicial="supervisor" />
      </div>
    );
  }
  // Adquisiciones trabaja en Gestión de Pedidos.
  if (perfil === "adquisiciones") redirect("/gestion-pedidos");

  return (
    <div className="mx-auto w-full max-w-[1100px]">
      <header className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-primary">
            Mis Pedidos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Busca tu nombre para ver en qué estado está cada uno de tus
            pedidos.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Sesión: {perfilLabel(perfil)}
          </span>
          <CerrarSesionButton />
        </div>
      </header>
      <MisPedidosPanel />
    </div>
  );
}
