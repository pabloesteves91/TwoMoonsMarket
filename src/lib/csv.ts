/** Minimaler, RFC-4180-naher CSV-Parser mit automatischer Trennzeichen-Erkennung. */

export interface ParsedCsv {
  header: string[];
  rows: string[][];
  delimiter: string;
}

export function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const c of candidates) {
    // Zeichen außerhalb von Anführungszeichen zählen
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === c && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const clean = text.replace(/^﻿/, '');
  const delim = delimiter ?? detectDelimiter(clean);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim().length > 0));
  const header = (nonEmpty.shift() ?? []).map((h) => h.trim());
  return { header, rows: nonEmpty, delimiter: delim };
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][], delimiter = ';'): string {
  const escape = (value: string | number | null | undefined): string => {
    const s = value === null || value === undefined ? '' : String(value);
    return /["\n\r]|[;,\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.map(escape).join(delimiter)];
  for (const row of rows) lines.push(row.map(escape).join(delimiter));
  return lines.join('\r\n');
}

/** Parst Zahlen aus CSV-Zellen, akzeptiert "1.234,56", "1,50 €", "1.50". */
export function parseNumber(raw: string | number | null | undefined): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (!raw) return undefined;
  let s = String(raw).trim().replace(/[€$£\s]/g, '');
  if (!s || s === '-' || s.toLowerCase() === 'n/a') return undefined;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Das hintere Zeichen ist das Dezimaltrennzeichen
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
