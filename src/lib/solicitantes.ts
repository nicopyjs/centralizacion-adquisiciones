import {
  getSpreadsheetMeta,
  readRange,
  solicitantesSheetId,
} from "./google-sheets";

/** Minúsculas y sin tildes, para comparar encabezados y valores. */
function norm(v: string | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

const VALORES_ACTIVO = new Set([
  "s",
  "si",
  "1",
  "true",
  "verdadero",
  "x",
  "activo",
  "activa",
  "vigente",
  "habilitado",
  "habilitada",
  "yes",
  "y",
]);

/**
 * Nombres de las personas activas de la planilla de solicitantes.
 *
 * La primera fila son los encabezados. Se detectan por nombre:
 *  - nombre:  "Nombre", "Nombre completo", "Solicitante", "Colaborador"…
 *             (o "Nombre(s)" + "Apellido(s)", que se unen)
 *  - activo:  "Activo", "Estado", "Vigente"… (S / Sí / Activo / 1 / TRUE)
 *
 * Pestaña: la indicada en SOLICITANTES_SHEET_GID; si no, la primera.
 */
export async function getSolicitantes(): Promise<string[]> {
  const id = solicitantesSheetId();
  const meta = await getSpreadsheetMeta(id);
  const sheets = [...meta.sheets].sort(
    (a, b) => a.properties.index - b.properties.index
  );
  const gid = process.env.SOLICITANTES_SHEET_GID;
  const hoja =
    (gid && sheets.find((s) => String(s.properties.sheetId) === gid)) ||
    sheets[0];
  if (!hoja) throw new Error("La planilla de solicitantes no tiene pestañas.");

  const rows = await readRange(id, `'${hoja.properties.title}'!A1:Z`);
  const headers = (rows[0] ?? []).map(norm);

  const colNombre = headers.findIndex((h) =>
    /^(nombre completo|nombre y apellido|nombres? y apellidos?|solicitante|colaborador|empleado|trabajador|usuario|persona|nombre)$/.test(
      h
    )
  );
  const colNombres = headers.findIndex((h) => /^nombres?$/.test(h));
  const colApellidos = headers.findIndex((h) => /^apellidos?/.test(h));
  const colActivo = headers.findIndex((h) =>
    /^(activo|activa|estado|vigente|vigencia|habilitado|habilitada)/.test(h)
  );

  const usaNombreApellido =
    colNombre === -1 && colNombres !== -1 && colApellidos !== -1;
  if (colNombre === -1 && !usaNombreApellido) {
    throw new Error(
      `No encontré la columna del nombre en la planilla de solicitantes. Encabezados: ${JSON.stringify(rows[0] ?? [])}`
    );
  }
  if (colActivo === -1) {
    throw new Error(
      `No encontré la columna "Activo" en la planilla de solicitantes. Encabezados: ${JSON.stringify(rows[0] ?? [])}`
    );
  }

  const nombres = new Set<string>();
  for (const row of rows.slice(1)) {
    if (!VALORES_ACTIVO.has(norm(row[colActivo]))) continue;
    const nombre = usaNombreApellido
      ? `${(row[colNombres] ?? "").trim()} ${(row[colApellidos] ?? "").trim()}`
      : (row[colNombre] ?? "").trim();
    const limpio = nombre.replace(/\s+/g, " ").trim();
    if (limpio) nombres.add(limpio);
  }

  return [...nombres].sort((a, b) => a.localeCompare(b, "es"));
}
