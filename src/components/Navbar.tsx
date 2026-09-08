"use client";

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
          className="flex items-center gap-2.5 py-3.5 text-sm font-extrabold tracking-tight text-primary"
        >
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-md bg-brand text-brand-foreground"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13 5.4 5M7 13l-2.3 4.6A1 1 0 0 0 5.6 19H17" />
              <circle cx="9" cy="21" r="1" />
              <circle cx="16" cy="21" r="1" />
            </svg>
          </span>
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
