/** Ячейка CSV: кавычки по RFC 4180 и защита от формул Excel (=, +, -, @ в начале значения). */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** CSV с BOM и разделителем «;» — так файл корректно открывается в русскоязычном Excel. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return "\uFEFF" + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}
