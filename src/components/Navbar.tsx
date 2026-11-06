"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const TAB_GESTION = { href: "/gestion-pedidos", label: "Gestión de Pedidos" };
const TAB_MIS_PEDIDOS = { href: "/mis-pedidos", label: "Pedidos del Área" };
const TABS_BASE = [
  { href: "/enviar-pedido", label: "Enviar Pedido" },
  { href: "/materiales-menores", label: "Materiales Menores" },
];

export default function Navbar() {
  const pathname = usePathname();
  // Cada perfil ve solo su sección; sin sesión aparecen ambas.
  const [perfil, setPerfil] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let cancelado = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelado) return;
        setPerfil(d?.perfil ?? null);
        setAdmin(Boolean(d?.admin));
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [pathname]);
  const TABS = [
    ...TABS_BASE,
    ...(perfil === null
      ? [TAB_GESTION, TAB_MIS_PEDIDOS]
      : admin
        ? [TAB_GESTION, TAB_MIS_PEDIDOS]
        : perfil === "adquisiciones"
          ? [TAB_GESTION]
        : [TAB_MIS_PEDIDOS]),
  ];
  // Gestión de Pedidos usa todo el ancho; el navbar acompaña ese mismo ancho.
  const ancho = pathname.startsWith("/gestion-pedidos")
    ? "max-w-[1800px]"
    : "max-w-[1440px]";

  return (
    <header className="sticky top-0 z-40 border-b border-border border-t-[3px] border-t-brand bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div
        className={`mx-auto flex ${ancho} flex-wrap items-center justify-between gap-x-3 px-4 sm:flex-nowrap sm:justify-start sm:gap-8 sm:px-6 lg:px-8`}
      >
        <Link
          href="/"
          className="flex shrink-0 items-center gap-3 py-2 text-sm sm:py-3 font-extrabold tracking-tight text-primary"
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

        <nav
          className="-mx-4 flex w-[calc(100%+2rem)] items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-t border-border px-2 sm:mx-0 sm:w-auto sm:border-t-0 sm:px-0 sm:gap-1"
          aria-label="Secciones"
        >
          {TABS.map((tab) => {
            const active =
              pathname === tab.href || pathname.startsWith(tab.href + "/");
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px whitespace-nowrap border-b-[3px] px-3 py-3 text-[13px] sm:py-4 font-semibold transition-colors sm:px-3 sm:text-sm ${
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
