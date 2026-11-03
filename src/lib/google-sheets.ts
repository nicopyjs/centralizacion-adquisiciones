import { JWT } from "google-auth-library";

/**
 * Cliente ligero para la API de Google Sheets usando una cuenta de servicio.
 *
 * Variables de entorno requeridas:
 *  - GOOGLE_SERVICE_ACCOUNT_EMAIL : correo de la cuenta de servicio
 *  - GOOGLE_PRIVATE_KEY           : private_key del JSON de la cuenta de servicio
 *                                  (los \n pueden ir escapados)
 *  - SHEET_ID                     : ID del spreadsheet de artículos / pedidos
 *  - CENTROS_SHEET_ID             : ID del spreadsheet de centros de negocio
 */

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  // Drive: adjuntos del chat de pedidos (carpeta compartida con la cuenta de servicio)
  "https://www.googleapis.com/auth/drive",
];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

/** Spreadsheet de artículos (y donde se escribe la pestaña Pedidos). */
export function articulosSheetId(): string {
  return requireEnv("SHEET_ID");
}

/** Spreadsheet de centros de negocio. */
export function centrosSheetId(): string {
  return requireEnv("CENTROS_SHEET_ID");
}

/** Spreadsheet con la nómina de solicitantes (con columna de activos). */
export function solicitantesSheetId(): string {
  return requireEnv("SOLICITANTES_SHEET_ID");
}

let cachedClient: JWT | null = null;

function getClient(): JWT {
  if (cachedClient) return cachedClient;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !rawKey) {
    throw new Error(
      "Faltan credenciales de Google. Define GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_PRIVATE_KEY."
    );
  }

  const key = rawKey.replace(/\\n/g, "\n");

  cachedClient = new JWT({ email, key, scopes: SCOPES });
  return cachedClient;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const client = getClient();
  const token = await client.getAccessToken();
  if (!token || !token.token) {
    throw new Error("No se pudo obtener un token de acceso de Google.");
  }
  return { Authorization: `Bearer ${token.token}` };
}

const API = "https://sheets.googleapis.com/v4/spreadsheets";

type SpreadsheetMeta = {
  sheets: { properties: { sheetId: number; title: string; index: number } }[];
};

export async function getSpreadsheetMeta(
  spreadsheetId: string
): Promise<SpreadsheetMeta> {
  const headers = await authHeaders();
  const res = await fetch(
    `${API}/${spreadsheetId}?fields=sheets.properties(sheetId,title,index)`,
    { headers, cache: "no-store" }
  );
  if (!res.ok) {
    throw new Error(
      `Error al leer metadatos del spreadsheet (${res.status}): ${await res.text()}`
    );
  }
  return (await res.json()) as SpreadsheetMeta;
}

/** Devuelve el título de la primera pestaña (por índice). */
export async function getFirstSheetTitle(spreadsheetId: string): Promise<string> {
  const meta = await getSpreadsheetMeta(spreadsheetId);
  const first = [...meta.sheets].sort(
    (a, b) => a.properties.index - b.properties.index
  )[0];
  if (!first) throw new Error("El spreadsheet no tiene pestañas.");
  return first.properties.title;
}

/** Lee un rango en formato A1 y devuelve la matriz de valores. */
export async function readRange(
  spreadsheetId: string,
  rangeA1: string
): Promise<string[][]> {
  const headers = await authHeaders();
  const res = await fetch(
    `${API}/${spreadsheetId}/values/${encodeURIComponent(rangeA1)}`,
    { headers, cache: "no-store" }
  );
  if (!res.ok) {
    throw new Error(
      `Error al leer el rango "${rangeA1}" (${res.status}): ${await res.text()}`
    );
  }
  const data = (await res.json()) as { values?: string[][] };
  return data.values ?? [];
}

/** Sobrescribe un rango (formato A1) con los valores dados. */
export async function writeRange(
  spreadsheetId: string,
  rangeA1: string,
  rows: (string | number)[][]
): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(
    `${API}/${spreadsheetId}/values/${encodeURIComponent(
      rangeA1
    )}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows }),
    }
  );
  if (!res.ok) {
    throw new Error(
      `Error al escribir el rango "${rangeA1}" (${res.status}): ${await res.text()}`
    );
  }
}

/** Escribe varios rangos distintos en una sola llamada (values:batchUpdate). */
export async function batchWriteRanges(
  spreadsheetId: string,
  data: { range: string; values: (string | number)[][] }[]
): Promise<void> {
  if (data.length === 0) return;
  const headers = await authHeaders();
  const res = await fetch(`${API}/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  });
  if (!res.ok) {
    throw new Error(
      `Error al escribir en lote (${res.status}): ${await res.text()}`
    );
  }
}

/** Agrega filas al final de una pestaña. */
export async function appendRows(
  spreadsheetId: string,
  sheetTitle: string,
  rows: (string | number)[][]
): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(
    `${API}/${spreadsheetId}/values/${encodeURIComponent(
      `${sheetTitle}!A:A`
    )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows }),
    }
  );
  if (!res.ok) {
    throw new Error(
      `Error al agregar filas a "${sheetTitle}" (${res.status}): ${await res.text()}`
    );
  }
}

/**
 * Elimina una fila completa de una pestaña. `fila` es el número de fila de la
 * planilla (base 1); las filas de abajo suben un lugar.
 */
export async function deleteRow(
  spreadsheetId: string,
  sheetTitle: string,
  fila: number
): Promise<void> {
  const meta = await getSpreadsheetMeta(spreadsheetId);
  const sheet = meta.sheets.find((s) => s.properties.title === sheetTitle);
  if (!sheet) throw new Error(`No existe la pestaña "${sheetTitle}".`);

  const headers = await authHeaders();
  const res = await fetch(`${API}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheet.properties.sheetId,
              dimension: "ROWS",
              startIndex: fila - 1,
              endIndex: fila,
            },
          },
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Error al eliminar la fila ${fila} de "${sheetTitle}" (${res.status}): ${await res.text()}`
    );
  }
}

/** Crea una pestaña si no existe. */
export async function ensureSheet(
  spreadsheetId: string,
  title: string
): Promise<void> {
  const meta = await getSpreadsheetMeta(spreadsheetId);
  if (meta.sheets.some((s) => s.properties.title === title)) return;

  const headers = await authHeaders();
  const res = await fetch(`${API}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title } } }],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Error al crear la pestaña "${title}" (${res.status}): ${await res.text()}`
    );
  }
}
