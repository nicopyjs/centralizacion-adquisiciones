// Sondeo SOLO LECTURA de Defontana para consumo interno. Solo corre contra replapi (pruebas).
// Uso: node --env-file=.env.local scripts/defontana-probe.mjs
const BASE = process.env.DEFONTANA_BASE_URL || "https://replapi.defontana.com";
const TOKEN = process.env.DEFONTANA_TOKEN;
if (!new URL(BASE).host.startsWith("replapi.")) {
  console.error("Abortado: este script solo corre contra replapi (pruebas). BASE =", BASE);
  process.exit(1);
}
if (!TOKEN) {
  console.error("Falta DEFONTANA_TOKEN (token de replapi) en .env.local");
  process.exit(1);
}

async function get(path, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
  return { status: res.status, body };
}
const show = (t, r) => console.log(`\n== ${t} -> HTTP ${r.status}\n`, JSON.stringify(r.body, null, 1).slice(0, 3500));

show("Tipos de documento de inventario", await get("/api/Inventory/GetTypeInventoryInfo", { itemsPerPage: 100, pageNumber: 1 }));
show("Definicion contable CI", await get("/api/Inventory/GetAccountingDefinition", { documentTypeId: "CI" }));
