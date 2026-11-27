import { appendRows, articulosSheetId, getFirstSheetTitle, readRange } from "./google-sheets";

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

/**
 * Anota en la hoja del catálogo un artículo recién creado en Defontana. La hoja
 * la rehace el Apps Script una vez al día con lo que hay en Defontana; mientras
 * tanto, esta fila hace que el artículo aparezca de inmediato. Si el Apps Script
 * agrega en vez de reemplazar, `getArticulos` descarta el código repetido.
 */
export async function agregarArticuloAlCatalogo(a: {
  codigo: string;
  nombre: string;
  categoriaId: number;
  categoria: string;
  unidad: string;
}): Promise<void> {
  const id = articulosSheetId();
  const sheetTitle = await getFirstSheetTitle(id);
  const fila: string[] = new Array(9).fill("");
  fila[COL.codigo] = a.codigo;
  fila[COL.nombre] = a.nombre;
  fila[COL.categoriaId] = String(a.categoriaId);
  fila[COL.categoria] = a.categoria;
  fila[COL.activo] = "S";
  fila[COL.unidad] = a.unidad;
  await appendRows(id, sheetTitle, [fila]);
}

/** Lee la hoja de artículos y devuelve los artículos activos. */
export async function getArticulos(): Promise<Articulo[]> {
  const id = articulosSheetId();
  const sheetTitle = await getFirstSheetTitle(id);
  const rows = await readRange(id, `${sheetTitle}!A2:O`);

  const articulos: Articulo[] = [];
  const vistos = new Set<string>();
  for (const row of rows) {
    const codigo = norm(row[COL.codigo]);
    const nombre = norm(row[COL.nombre]);
    if (!codigo || !nombre || vistos.has(codigo)) continue;
    vistos.add(codigo);

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
