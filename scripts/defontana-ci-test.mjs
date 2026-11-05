// Prueba de UN consumo interno en replapi (pruebas). Nunca corre contra produccion.
// Uso: node --env-file=.env.local scripts/defontana-ci-test.mjs [insert|delete <externalId>]
const BASE = process.env.DEFONTANA_BASE_URL || "https://replapi.defontana.com";
const TOKEN = process.env.DEFONTANA_TOKEN;
if (!new URL(BASE).host.startsWith("replapi.")) { console.error("Solo replapi"); process.exit(1); }
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "application/json" };
const ext = "TEST-NEB-001";
const body = {
  documentTypeId: "CI",
  fiscalYear: "2026",
  gloss: "PRUEBA NEB adquisiciones - borrar",
  originStowageId: "BC14",
  date: new Date().toISOString().slice(0, 10),
  externalDocumentID: ext,
  analysis: { businessCenter: "GNNADM000000000" },
  details: [{ articleId: "AICA0081", count: 1, price: 0, analysis: { businessCenter: "GNNADM000000000" } }],
};
const [cmd = "insert", arg] = process.argv.slice(2);
const res = cmd === "delete"
  ? await fetch(`${BASE}/api/Inventory/Delete?${new URLSearchParams(arg)}`, { method: "DELETE", headers: H })
  : await fetch(`${BASE}/api/Inventory/Insert`, { method: "POST", headers: H, body: JSON.stringify(body) });
console.log(res.status, (await res.text()).slice(0, 2500));
