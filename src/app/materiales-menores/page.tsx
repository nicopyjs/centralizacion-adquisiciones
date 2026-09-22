import EnviarPedidoForm from "@/components/EnviarPedidoForm";

export const metadata = {
  title: "Materiales Menores | Centralización Adquisiciones",
};

// Categorías de artículos disponibles en este flujo reducido.
const CATEGORIAS_MATERIALES_MENORES = [
  "INSUMOS GENERICO",
  "FIJACIONES GENERICO",
  "EPP GENERICO",
  "EPP ROPA",
  "HERRAMIENTAS ELECTRICA",
  "HERRAMIENTAS MANUALES",
  "ELECTRICO TABLERO",
];

export default function MaterialesMenoresPage() {
  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">
          Materiales Menores
        </h1>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Elige el área y su centro de negocio, arma la lista de artículos y
          registra el pedido: se guarda en la planilla y se abre Gmail con el
          correo de solicitud ya redactado para revisarlo y enviarlo.
        </p>
      </header>
      <EnviarPedidoForm categoriasPermitidas={CATEGORIAS_MATERIALES_MENORES} />
    </div>
  );
}
