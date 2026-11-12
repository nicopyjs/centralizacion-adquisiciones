import { redirect } from "next/navigation";
import CerrarSesionButton from "@/components/CerrarSesionButton";
import CambiarAreaSelect from "@/components/CambiarAreaSelect";
import CambiarVistaAdmin from "@/components/CambiarVistaAdmin";
import GestionPedidosPanel from "@/components/GestionPedidosPanel";
import LoginGestion from "@/components/LoginGestion";
import { getPerfil, perfilLabel } from "@/lib/auth";
import { getGoogleEmail } from "@/lib/google-oauth";
import { perfilDeEmail } from "@/lib/usuarios";

export const metadata = {
  title: "Gestión de Pedidos | Centralización Adquisiciones",
};

// Depende de la cookie de sesión, así que nunca se sirve prerenderizada.
export const dynamic = "force-dynamic";

export default async function GestionPedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // `?pedido=INT-27` abre el panel con ese pedido seleccionado (desde KPIs).
  const { pedido } = await searchParams;
  const pedidoInicial = (Array.isArray(pedido) ? pedido[0] : pedido)?.trim() || undefined;
  const perfil = await getPerfil();
  if (!perfil) {
    return (
      <div className="py-8">
        <LoginGestion areaInicial="adquisiciones" />
      </div>
    );
  }
  // Supervisor y Maestro solo consultan: van a su vista. El admin, que puede
  // estar mirando un área, elige volver a Adquisiciones.
  const admin = perfilDeEmail(await getGoogleEmail())?.admin ?? false;
  if (perfil !== "adquisiciones") {
    if (admin) return <CambiarVistaAdmin destino="adquisiciones" />;
    redirect("/mis-pedidos");
  }

  return (
    <div className="mx-auto w-full max-w-[1800px]">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-primary">
            Gestión de Pedidos
          </h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Recepción, entrega y cierre de los pedidos de todas las áreas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Sesión: {perfilLabel(perfil)}
          </span>
          {admin && <CambiarAreaSelect actual="adquisiciones" />}
          <CerrarSesionButton />
        </div>
      </header>
      <GestionPedidosPanel pedidoInicial={pedidoInicial} />
    </div>
  );
}
