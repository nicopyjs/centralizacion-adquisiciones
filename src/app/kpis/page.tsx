import { redirect } from "next/navigation";
import CerrarSesionButton from "@/components/CerrarSesionButton";
import CambiarAreaSelect from "@/components/CambiarAreaSelect";
import CambiarVistaAdmin from "@/components/CambiarVistaAdmin";
import KpisPanel from "@/components/KpisPanel";
import LoginGestion from "@/components/LoginGestion";
import { getPerfil, perfilLabel } from "@/lib/auth";
import { getGoogleEmail } from "@/lib/google-oauth";
import { perfilDeEmail } from "@/lib/usuarios";

export const metadata = {
  title: "KPIs | Centralización Adquisiciones",
};

// Depende de la cookie de sesión, así que nunca se sirve prerenderizada.
export const dynamic = "force-dynamic";

export default async function KpisPage() {
  const perfil = await getPerfil();
  if (!perfil) {
    return (
      <div className="py-8">
        <LoginGestion areaInicial="adquisiciones" />
      </div>
    );
  }
  // Solo Adquisiciones mide su propio desempeño; el admin que está viendo un
  // área vuelve a Adquisiciones desde la tarjeta.
  const admin = perfilDeEmail(await getGoogleEmail())?.admin ?? false;
  if (perfil !== "adquisiciones") {
    if (admin) return <CambiarVistaAdmin destino="adquisiciones" />;
    redirect("/mis-pedidos");
  }

  return (
    <div className="mx-auto w-full max-w-[1800px]">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-primary">KPIs de Adquisiciones</h1>
          <span aria-hidden className="mt-1 mb-1 block h-1 w-10 rounded-full bg-brand" />
          <p className="hidden text-sm text-muted-foreground sm:block">
            Tiempos, cumplimiento y pendientes de los pedidos de todas las áreas.
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
      <KpisPanel />
    </div>
  );
}
