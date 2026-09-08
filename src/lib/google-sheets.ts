import { JWT } from "google-auth-library";

/**
 * Cliente ligero para la API de Google Sheets usando una cuenta de servicio.
 *
 * Variables de entorno requeridas:
 *  - GOOGLE_SERVICE_ACCOUNT_EMAIL : correo de la cuenta de servicio
 *  - GOOGLE_PRIVATE_KEY           : private_key del JSON de la cuenta de servicio
 *                                  (los \n pueden ir escapados)
 *  - SHEET_ID                     : ID del spreadsheet
 */

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

export function getSheetId(): string {
  const id = process.env.SHEET_ID;
  if (!id) {
    throw new Error("Falta la variable de entorno SHEET_ID");
  }
  return id;
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

async function authHeaders(): Promise<Record<string, string>> {
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

export async function getSpreadsheetMeta(): Promise<SpreadsheetMeta> {
  const headers = await authHeaders();
  const res = await fetch(
    `${API}/${getSheetId()}?fields=sheets.properties(sheetId,title,index)`,
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
export async function getFirstSheetTitle(): Promise<string> {
  const meta = await getSpreadsheetMeta();
  const first = [...meta.sheets].sort(
    (a, b) => a.properties.index - b.properties.index
  )[0];
  if (!first) throw new Error("El spreadsheet no tiene pestañas.");
  return first.properties.title;
}

/** Lee un rango en formato A1 y devuelve la matriz de valores. */
export async function readRange(rangeA1: string): Promise<string[][]> {
  const headers = await authHeaders();
  const res = await fetch(
    `${API}/${getSheetId()}/values/${encodeURIComponent(rangeA1)}`,
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

/** Agrega filas al final de una pestaña. */
export async function appendRows(
  sheetTitle: string,
  rows: (string | number)[][]
): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(
    `${API}/${getSheetId()}/values/${encodeURIComponent(
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

/** Crea una pestaña si no existe. */
export async function ensureSheet(title: string): Promise<void> {
  const meta = await getSpreadsheetMeta();
  if (meta.sheets.some((s) => s.properties.title === title)) return;

  const headers = await authHeaders();
  const res = await fetch(`${API}/${getSheetId()}:batchUpdate`, {
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
