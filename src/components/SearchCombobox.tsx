"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Minúsculas y sin tildes, para buscar "jose" y encontrar "José". */
function sinTildes(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// 16px en celular (evita el zoom automático de iOS al enfocar el campo).
const fieldBase =
  "w-full rounded-lg border border-border bg-card px-3 text-base sm:text-sm text-card-foreground shadow-sm outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

function IconChevron() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export type ComboOption = { value: string; label: string };

/**
 * Combobox con búsqueda por texto: escribe para filtrar por `label` y elige
 * una opción; `onChange` recibe su `value`. La lista se renderiza en un
 * portal (posición fija calculada desde el input) para que no se corte
 * dentro de contenedores con scroll, como la tabla de artículos.
 */
export default function SearchCombobox({
  id,
  ariaLabel,
  options,
  searchOptions,
  value,
  onChange,
  placeholder = "Escribe para buscar…",
  disabled,
  clearable,
  allowCustom,
  size = "md",
  inputClassName = "",
  invalid,
  autoFocus,
}: {
  id?: string;
  ariaLabel?: string;
  /** Opciones que se muestran al abrir el combo sin haber escrito nada. */
  options: ComboOption[];
  /**
   * Universo donde buscar una vez que se escribe texto (por ejemplo, "todos
   * los artículos" aunque `options` venga acotado a una categoría). Si no se
   * pasa, se busca dentro de `options`.
   */
  searchOptions?: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Muestra una «×» para limpiar la selección sin abrir la lista. */
  clearable?: boolean;
  /**
   * Modo texto libre: lo que se escribe pasa a ser el valor (aunque no esté en
   * las opciones) y las opciones actúan solo como sugerencias.
   */
  allowCustom?: boolean;
  /** «sm» (h-9) para tablas densas; «md» (h-11) para formularios. */
  size?: "sm" | "md";
  inputClassName?: string;
  /** Borde rojo: campo obligatorio sin completar. */
  invalid?: boolean;
  /** Enfoca el campo al montarse (p. ej. una fila recién agregada). */
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<{
    top: number;
    bottom: number;
    left: number;
    width: number;
    openUp: boolean;
    maxHeight: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
    // Solo al montar: re-renders posteriores no deben robar el foco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const universoBusqueda = searchOptions ?? options;

  const selected = useMemo(
    () => universoBusqueda.find((o) => o.value === value) ?? null,
    [universoBusqueda, value]
  );

  const filtradas = useMemo(() => {
    const q = sinTildes(query.trim());
    if (!q) return options;
    return universoBusqueda.filter((o) => sinTildes(o.label).includes(q));
  }, [options, universoBusqueda, query]);

  function actualizarRect() {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margen = 8;
    const espacioAbajo = window.innerHeight - r.bottom - margen;
    const espacioArriba = r.top - margen;
    // Si no cabe abajo pero sí hay más espacio arriba, la lista se abre
    // hacia arriba (por ejemplo, cuando el combo está cerca del pie de
    // pantalla y el navegador achica el viewport, como al hacer zoom).
    const openUp = espacioAbajo < 160 && espacioArriba > espacioAbajo;
    const maxHeight = Math.max(
      120,
      Math.min(256, openUp ? espacioArriba : espacioAbajo)
    );
    setRect({
      top: r.bottom,
      bottom: window.innerHeight - r.top,
      left: r.left,
      width: r.width,
      openUp,
      maxHeight,
    });
  }

  useEffect(() => {
    if (!open) return;
    actualizarRect();
    window.addEventListener("scroll", actualizarRect, true);
    window.addEventListener("resize", actualizarRect);
    return () => {
      window.removeEventListener("scroll", actualizarRect, true);
      window.removeEventListener("resize", actualizarRect);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function seleccionar(o: ComboOption) {
    onChange(o.value);
    setQuery("");
    setOpen(false);
  }

  const displayValue = open
    ? query
    : selected?.label ?? (allowCustom ? value : "");
  const mostrarLimpiar = clearable && !disabled && !!value;

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={`${invalid ? fieldBase.replace("border-border", "border-destructive") : fieldBase} ${size === "sm" ? "h-9" : "h-11"} ${
          mostrarLimpiar ? "pr-16" : "pr-9"
        } ${inputClassName}`}
        placeholder={placeholder}
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          if (allowCustom) onChange(e.target.value);
          setActiveIndex(0);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          // En texto libre el valor ya escrito queda editable al abrir.
          if (allowCustom) setQuery(value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            setActiveIndex((i) => Math.min(i + 1, filtradas.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            if (open) {
              e.preventDefault();
              const o = filtradas[activeIndex];
              if (o) seleccionar(o);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
        }}
      />
      {mostrarLimpiar && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Quitar selección"
          onMouseDown={(e) => {
            // preventDefault evita el blur del input antes del click.
            e.preventDefault();
            onChange("");
            setQuery("");
            setOpen(false);
          }}
          className="absolute right-8 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
        >
          <IconX />
        </button>
      )}
      <span
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      >
        <IconChevron />
      </span>
      {open &&
        rect &&
        createPortal(
          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            style={{
              position: "fixed",
              ...(rect.openUp
                ? { bottom: rect.bottom + 4 }
                : { top: rect.top + 4 }),
              left: rect.left,
              width: rect.width,
              maxHeight: rect.maxHeight,
            }}
            className="z-50 overflow-auto rounded-lg border border-border bg-card py-1 text-sm shadow-lg"
          >
            {filtradas.length === 0 ? (
              <li className="px-3 py-2 text-muted-foreground">Sin resultados</li>
            ) : (
              filtradas.map((o, i) => (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    seleccionar(o);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`cursor-pointer px-3 py-2 text-card-foreground ${
                    i === activeIndex ? "bg-accent/10" : ""
                  } ${o.value === value ? "font-semibold" : ""}`}
                >
                  {o.label}
                </li>
              ))
            )}
          </ul>,
          document.body
        )}
    </div>
  );
}

function IconX() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
