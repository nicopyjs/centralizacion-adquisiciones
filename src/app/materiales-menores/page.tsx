import EnviarPedidoForm from "@/components/EnviarPedidoForm";
import { CATEGORIAS_MATERIALES_MENORES } from "@/lib/materiales-menores";

export const metadata = {
  title: "Materiales Menores | Centralización Adquisiciones",
};

export default function MaterialesMenoresPage() {
  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">
          Materiales Menores
        </h1>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Elige el área y su centro de negocio, arma la lista de artículos y
          registra el pedido. Los maestros no necesitan cuenta: su pedido queda
          pendiente hasta que un supervisor de su área lo apruebe. Con cuenta
          @nebchile.cl se envía directo a Adquisiciones por correo.
        </p>
      </header>
      <EnviarPedidoForm categoriasPermitidas={CATEGORIAS_MATERIALES_MENORES} />
    </div>
  );
}
