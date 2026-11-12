/**
 * La «Fecha de entrega» de la planilla llega en distintos formatos según cómo
 * la guardó Sheets: "DD-MM-AA", "DD-MM-AAAA", "AAAA-MM-DD" o un número de
 * serie (días desde 1899-12-30). Devuelve "AAAA-MM-DD" (lo que usa
 * <input type="date"> y valida el servidor), o "" si no se entiende.
 */
export function fechaEntregaAYMD(s: string): string {
  const t = s.trim();
  let f: Date | null = null;
  // Día esperado: un 31-02 no es una fecha, y `Date` lo correría al 03-03.
  let dia = 0;

  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) {
    dia = Number(m[3]);
    f = new Date(Number(m[1]), Number(m[2]) - 1, dia);
  }
  if (!f && (m = /^(\d{2})-(\d{2})-(\d{2}|\d{4})$/.exec(t))) {
    const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    dia = Number(m[1]);
    f = new Date(anio, Number(m[2]) - 1, dia);
  }
  if (!f && /^\d{5}$/.test(t)) {
    f = new Date(1899, 11, 30 + Number(t));
    dia = f.getDate();
  }

  if (!f || Number.isNaN(f.getTime()) || f.getDate() !== dia) return "";
  const mm = String(f.getMonth() + 1).padStart(2, "0");
  const dd = String(f.getDate()).padStart(2, "0");
  return `${f.getFullYear()}-${mm}-${dd}`;
}
