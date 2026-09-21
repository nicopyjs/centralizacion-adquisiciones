import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// En celular la página se ve al 100% y no se puede alejar (zoom-out) hasta
// dejarla diminuta; acercar sigue permitido por accesibilidad.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
};

export const metadata: Metadata = {
  title: "Centralización Adquisiciones",
  description: "Sistema interno de pedidos y adquisiciones",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${plusJakarta.variable} h-full`}
      suppressHydrationWarning
    >
      <body
        className="flex min-h-full flex-col bg-background text-foreground"
        suppressHydrationWarning
      >
        <Navbar />
        {/* El ancho máximo lo define cada página (Enviar Pedido es angosta,
            Gestión de Pedidos aprovecha la pantalla completa). */}
        <main className="w-full flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          {children}
        </main>
        <footer className="border-t border-border py-5 text-center text-xs text-muted-foreground">
          Centralización Adquisiciones · uso interno
        </footer>
      </body>
    </html>
  );
}
