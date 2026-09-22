"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/enviar-pedido", label: "Enviar Pedido" },
  { href: "/materiales-menores", label: "Materiales Menores" },
  { href: "/gestion-pedidos", label: "Gestión de Pedidos" },
];

export default function Navbar() {
  const pathname = usePathname();
  // Gestión de Pedidos usa todo el ancho; el navbar acompaña ese mismo ancho.
  const ancho = pathname.startsWith("/gestion-pedidos")
    ? "max-w-[1800px]"
    : "max-w-[1440px]";

  return (
    <header className="sticky top-0 z-40 border-b border-border border-t-[3px] border-t-brand bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div
        className={`mx-auto flex ${ancho} items-center justify-between gap-3 px-4 sm:justify-start sm:gap-8 sm:px-6 lg:px-8`}
      >
        <Link
          href="/"
          className="flex shrink-0 items-center gap-3 py-3 text-sm font-extrabold tracking-tight text-primary"
        >
          <Image
            src="/neb-logo.jpg"
            alt="NEB Chile"
            width={1280}
            height={568}
            priority
            className="h-8 w-auto"
          />
          <span
            aria-hidden
            className="hidden h-6 w-px bg-border sm:block"
          />
          <span className="hidden sm:inline">Centralización Adquisiciones</span>
          <span className="sr-only sm:hidden">Adquisiciones</span>
        </Link>

        <nav className="flex items-center sm:gap-1" aria-label="Secciones">
          {TABS.map((tab) => {
            const active =
              pathname === tab.href || pathname.startsWith(tab.href + "/");
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px whitespace-nowrap border-b-[3px] px-2.5 py-4 text-[13px] font-semibold transition-colors sm:px-3 sm:text-sm ${
                  active
                    ? "border-brand text-primary"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-primary"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
