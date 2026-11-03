import type { Area, Perfil } from "@/lib/auth";

/**
 * Perfil que recibe cada cuenta @nebchile.cl al entrar con Google, sin pedir
 * contraseña. Las contraseñas de /api/auth/login siguen funcionando.
 *
 *  - adquisiciones : gestiona todos los pedidos.
 *  - admin         : Adquisiciones + supervisor de todas las áreas; cambia de
 *                    vista (Gestión de Pedidos / Pedidos del Área) sin cerrar sesión.
 *  - supervisor    : consulta/reporta los pedidos de sus áreas. Quien está en
 *                    más de un área (p. ej. nicolas, ercio) puede cambiar de
 *                    área; la sesión trabaja en una a la vez.
 *
 * Para agregar o quitar a alguien: editar esta lista (según los grupos de
 * Google Workspace) y desplegar.
 */
type Entrada = { perfil: "adquisiciones" } | { perfil: "supervisor"; areas: Area[] };

const ADQUISICIONES = ["dsuazo"];
const ADMINS = ["npalma"];
const TODAS_LAS_AREAS: Area[] = [
  "refacciones",
  "servicio-tecnico",
  "instalaciones",
  "transicion-postventa",
];

const POR_AREA: Record<Area, string[]> = {
  refacciones: ["cvidal", "hnanco", "jsanchez", "nicolas", "pjorquera"],
  instalaciones: [
    "atihista",
    "cesalamanca",
    "cesar",
    "epenaloza",
    "ercio",
    "felipe.bustos",
    "fmorales",
    "iaraya",
    "vsantibanez",
  ],
  "servicio-tecnico": [
    "driquelme",
    "ecardenas",
    "ercio",
    "fosorio",
    "mmansilla",
    "nicolas",
    "servicios",
    "torellana",
  ],
  "transicion-postventa": ["iguajardo"],
};

const DOMINIO = "@nebchile.cl";

function construir(): Map<string, Entrada> {
  const m = new Map<string, Entrada>();
  for (const [area, usuarios] of Object.entries(POR_AREA) as [Area, string[]][]) {
    for (const u of usuarios) {
      const email = `${u}${DOMINIO}`;
      const previo = m.get(email);
      if (previo?.perfil === "supervisor") previo.areas.push(area);
      else m.set(email, { perfil: "supervisor", areas: [area] });
    }
  }
  for (const u of ADQUISICIONES) m.set(`${u}${DOMINIO}`, { perfil: "adquisiciones" });
  return m;
}

const USUARIOS = construir();

export type PerfilUsuario = { perfil: Perfil; areas: Area[]; admin: boolean };

/** Perfil y áreas permitidas de un correo, o null si no tiene acceso. */
export function perfilDeEmail(email: string | null | undefined): PerfilUsuario | null {
  const correo = (email ?? "").toLowerCase();
  if (ADMINS.some((u) => `${u}${DOMINIO}` === correo)) {
    return { perfil: "adquisiciones", areas: TODAS_LAS_AREAS, admin: true };
  }
  const e = USUARIOS.get(correo);
  if (!e) return null;
  return e.perfil === "adquisiciones"
    ? { perfil: "adquisiciones", areas: [], admin: false }
    : { perfil: "supervisor", areas: e.areas, admin: false };
}
