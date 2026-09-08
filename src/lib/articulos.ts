import { getFirstSheetTitle, readRange } from "./google-sheets";

export type Articulo = {
  codigo: string;
  nombre: string;
  categoriaId: string;
  categoria: string;
  unidad: string;
};

export type CategoriaConArticulos = {
  categoriaId: string;
  categoria: string;
  articulos: Articulo[];
};

// Índices de columna según la hoja de artículos.
const COL = {
  codigo: 0, // A  Código
  nombre: 1, // B  Nombre
  categoriaId: 2, // C  Categoría ID
  categoria: 3, // D  Categoría
  activo: 6, // G  Activo (S/N)
  unidad: 8, // I  Unidad
  disponibleVenta: 14, // O  Disponible Venta (SI/NO)
};

function norm(v: string | undefined): string {
  return (v ?? "").trim();
}

/** Lee la hoja de artículos y devuelve los artículos activos. */
export async function getArticulos(): Promise<Articulo[]> {
  const sheetTitle = await getFirstSheetTitle();
  const rows = await readRange(`${sheetTitle}!A2:O`);

  const articulos: Articulo[] = [];
  for (const row of rows) {
    const codigo = norm(row[COL.codigo]);
    const nombre = norm(row[COL.nombre]);
    if (!codigo || !nombre) continue;

    const activo = norm(row[COL.activo]).toUpperCase();
    if (activo && activo !== "S" && activo !== "SI") continue;

    articulos.push({
      codigo,
      nombre,
      categoriaId: norm(row[COL.categoriaId]),
      categoria: norm(row[COL.categoria]) || "Sin categoría",
      unidad: norm(row[COL.unidad]) || "UN",
    });
  }

  articulos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return articulos;
}

/** Agrupa los artículos por categoría, ordenados alfabéticamente. */
export async function getCategoriasConArticulos(): Promise<
  CategoriaConArticulos[]
> {
  const articulos = await getArticulos();
  const mapa = new Map<string, CategoriaConArticulos>();

  for (const art of articulos) {
    const key = art.categoria;
    let grupo = mapa.get(key);
    if (!grupo) {
      grupo = {
        categoriaId: art.categoriaId,
        categoria: art.categoria,
        articulos: [],
      };
      mapa.set(key, grupo);
    }
    grupo.articulos.push(art);
  }

  return [...mapa.values()].sort((a, b) =>
    a.categoria.localeCompare(b.categoria, "es")
  );
}
