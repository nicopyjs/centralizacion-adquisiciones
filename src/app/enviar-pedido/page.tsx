import EnviarPedidoForm from "@/components/EnviarPedidoForm";

export const metadata = {
  title: "Enviar Pedido | Centralización Adquisiciones",
};

export default function EnviarPedidoPage() {
  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-primary">
          Enviar Pedido
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Selecciona una categoría, elige el artículo y la cantidad. Puedes
          agregar varios artículos antes de enviar el pedido.
        </p>
      </header>
      <EnviarPedidoForm />
    </div>
  );
}
