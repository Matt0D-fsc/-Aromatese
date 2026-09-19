// CSV for spreadsheets, not for parsers. Excel treats a cell starting with = + - or @ as a formula, so a
// product called "=cmd" or a customer note pasted from somewhere could execute on a merchant's machine when
// they open the export. Prefixing with a quote makes Excel read it as text.
export function csvCell(value: unknown): string {
  if (value == null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

// The BOM is what makes Excel open Bangla text as UTF-8 instead of mojibake.
export const csvFile = (headers: string[], rows: Record<string, unknown>[]) =>
  `﻿${[headers.join(','), ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(','))].join('\r\n')}`;
