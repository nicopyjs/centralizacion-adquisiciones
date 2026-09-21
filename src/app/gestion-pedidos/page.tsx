import CerrarSesionButton from "@/components/CerrarSesionButton";
import GestionPedidosPanel from "@/components/GestionPedidosPanel";
import LoginGestion from "@/components/LoginGestion";
import { GESTION_USUARIO, haySesion } from "@/lib/auth";

export const metadata = {
  title: "Gestión de Pedidos | Centralización Adquisiciones",
};

// Depende de la cookie de sesión, así que nunca se sirve prerenderizada.
export const dynamic = "force-dynamic";

export default async function GestionPedidosPage() {
  if (!(await haySesion())) {
    return (
      <div className="py-8">
        <LoginGestion usuario={GESTION_USUARIO} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1800px]">
      <header className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-primary">
            Gestión de Pedidos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Registra lo recibido, el consumo interno y quién recepciona. Los
            cambios se guardan directamente en la planilla.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Sesión: {GESTION_USUARIO}
          </span>
          <CerrarSesionButton />
        </div>
      </header>
      <GestionPedidosPanel />
    </div>
  );
}
