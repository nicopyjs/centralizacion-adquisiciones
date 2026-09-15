import GestionPedidosPanel from "@/components/GestionPedidosPanel";

export const metadata = {
  title: "Gestión de Pedidos | Centralización Adquisiciones",
};

export default function GestionPedidosPage() {
  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-primary">
          Gestión de Pedidos
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Revisa los pedidos registrados por los maestros y actualiza, por
          artículo, la cantidad recibida, el consumo interno y el parte de
          entrada. Los cambios se guardan directamente en la planilla.
        </p>
      </header>
      <GestionPedidosPanel />
    </div>
  );
}
