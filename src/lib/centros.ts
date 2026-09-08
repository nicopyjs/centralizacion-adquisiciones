import { centrosSheetId, getFirstSheetTitle, readRange } from "./google-sheets";

export type CentroNegocio = {
  codigo: string;
  descripcion: string;
};

// Columnas de la hoja de centros de negocio.
const COL = {
  parentCode: 0, // A  Parent Code
  parentDesc: 1, // B  Parent Description
  code: 2, // C  Code
  desc: 3, // D  Description
  imputable: 4, // E  Imputable (S/N)
  activo: 5, // F  Activo (S/N)
};

function norm(v: string | undefined): string {
  return (v ?? "").trim();
}

/**
 * Centros de negocio válidos para imputar un pedido:
 * solo los que tienen `Imputable = S` y `Activo = S`.
 */
export async function getCentrosNegocio(): Promise<CentroNegocio[]> {
  const id = centrosSheetId();
  const sheetTitle = await getFirstSheetTitle(id);
  const rows = await readRange(id, `${sheetTitle}!A2:F`);

  const centros: CentroNegocio[] = [];
  for (const row of rows) {
    const codigo = norm(row[COL.code]);
    const descripcion = norm(row[COL.desc]);
    if (!codigo || !descripcion) continue;
    if (norm(row[COL.imputable]).toUpperCase() !== "S") continue;
    if (norm(row[COL.activo]).toUpperCase() !== "S") continue;

    centros.push({ codigo, descripcion });
  }

  centros.sort((a, b) => a.descripcion.localeCompare(b.descripcion, "es"));
  return centros;
}
