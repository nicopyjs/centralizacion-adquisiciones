"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [{ href: "/enviar-pedido", label: "Enviar Pedido" }];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border border-t-[3px] border-t-brand bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex max-w-5xl items-center gap-8 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-3 py-3 text-sm font-extrabold tracking-tight text-primary"
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
          <span className="sm:hidden">Adquisiciones</span>
        </Link>

        <nav className="flex items-center gap-1" aria-label="Secciones">
          {TABS.map((tab) => {
            const active =
              pathname === tab.href || pathname.startsWith(tab.href + "/");
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px border-b-[3px] px-3 py-4 text-sm font-semibold transition-colors ${
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
