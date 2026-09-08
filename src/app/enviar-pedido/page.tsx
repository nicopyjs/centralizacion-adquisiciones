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
          Completa los datos, arma la lista de artículos y abre el correo de
          solicitud ya redactado en Gmail para revisarlo y enviarlo.
        </p>
      </header>
      <EnviarPedidoForm />
    </div>
  );
}
