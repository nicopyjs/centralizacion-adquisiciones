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
    <div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-primary">
            Gestión de Pedidos
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Revisa los pedidos registrados por los maestros y actualiza, por
            artículo, la cantidad recibida, el consumo interno y el parte de
            entrada. Los cambios se guardan directamente en la planilla.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <CerrarSesionButton />
          <span className="text-xs text-muted-foreground">
            Sesión: {GESTION_USUARIO}
          </span>
        </div>
      </header>
      <GestionPedidosPanel />
    </div>
  );
}
