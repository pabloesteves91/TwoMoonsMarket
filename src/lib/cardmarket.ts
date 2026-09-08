import type { GameId, PriceEntry } from '../types';
import { buildMatchKey, buildNameKey } from './pricing';
import { parseCsv, parseNumber } from './csv';

/**
 * Import der Cardmarket-Preisliste.
 *
 * Unterstützt drei Formate, weil Cardmarket je nach Quelle unterschiedlich liefert:
 *
 *  1. Price-Guide-JSON (`{ version, createdAt, priceGuides: [{ idProduct, avg, low, trend, ... }] }`)
 *     – enthält nur Produkt-IDs, keine Namen. Optional lässt sich ein Produkt-Katalog
 *       (`{ products: [{ idProduct, name, expansion, ... }] }`) dazuladen.
 *  2. Produkt-Katalog-JSON/CSV mit Namen – wird mit einer bereits importierten
 *     Preisliste über `idProduct` zusammengeführt.
 *  3. Beliebige CSV mit Namen und Preisspalten (z.B. aus der Price-Guide-Seite kopiert
 *     oder aus einem eigenen Export) – Spalten werden über Aliase erkannt.
 */

export interface ImportResult {
  entries: PriceEntry[];
  /** Erkanntes Format für die Anzeige */
  format: string;
  /** Anzahl Zeilen ohne verwertbaren Preis */
  skipped: number;
  /** Erkannte Spaltenzuordnung (nur bei CSV) */
  mapping?: Record<string, string>;
  warnings: string[];
}

type Aliases = Record<string, string[]>;

/** Spaltenaliase: Zielfeld -> mögliche Header-Schreibweisen (klein, ohne Sonderzeichen). */
const COLUMN_ALIASES: Aliases = {
  cardmarketProductId: ['idproduct', 'productid', 'product id', 'id'],
  name: ['name', 'cardname', 'card name', 'englishname', 'english name', 'product', 'productname'],
  set: ['set', 'expansion', 'edition', 'series', 'expansioncode', 'abbreviation'],
  setName: ['setname', 'expansionname', 'editionname'],
  number: ['number', 'collectornumber', 'cardnumber', 'no', 'nr'],
  rarity: ['rarity', 'seltenheit'],
  avg: ['avg', 'avgsellprice', 'avg sell price', 'averagesellprice', 'average', 'durchschnitt'],
  low: ['low', 'lowprice', 'low price', 'from', 'ab'],
  lowEx: ['lowex', 'lowpriceex', 'low price ex+', 'lowpriceexplus', 'lowexplus'],
  trend: ['trend', 'trendprice', 'trend price', 'preistrend'],
  germanProLow: ['germanprolow', 'german pro low', 'deprolow', 'prolow'],
  suggested: ['suggested', 'suggestedprice', 'suggested price', 'sell price'],
  avg1: ['avg1', 'avg1day', '1day', 'avg 1'],
  avg7: ['avg7', 'avg7days', '7days', 'avg 7'],
  avg30: ['avg30', 'avg30days', '30days', 'avg 30'],
  foilSell: ['foilsell', 'foil sell', 'foilavgsellprice', 'foilaverage'],
  foilLow: ['foillow', 'foil low', 'foillowprice'],
  foilTrend: ['foiltrend', 'foil trend', 'foiltrendprice'],
  foilAvg1: ['foilavg1', 'foil avg1', 'foilavg1day'],
  foilAvg7: ['foilavg7', 'foil avg7', 'foilavg7days'],
  foilAvg30: ['foilavg30', 'foil avg30', 'foilavg30days'],
};

const NUMERIC_FIELDS = [
  'avg', 'low', 'lowEx', 'trend', 'germanProLow', 'suggested', 'avg1', 'avg7', 'avg30',
  'foilSell', 'foilLow', 'foilTrend', 'foilAvg1', 'foilAvg7', 'foilAvg30',
] as const;

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9+]+/g, '');
}

function buildMapping(header: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  const normalized = header.map(normalizeHeader);
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const wanted = aliases.map((a) => a.replace(/[^a-z0-9+]+/g, ''));
    const index = normalized.findIndex((h) => wanted.includes(h));
    if (index > -1 && !Object.values(mapping).includes(index)) mapping[field] = index;
  }
  return mapping;
}

function makeEntry(gameId: GameId, raw: Record<string, unknown>, source: string): PriceEntry | null {
  const productId =
    typeof raw.cardmarketProductId === 'number'
      ? raw.cardmarketProductId
      : parseNumber(raw.cardmarketProductId as string);
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name && !productId) return null;

  const set = typeof raw.set === 'string' && raw.set.trim() ? raw.set.trim() : undefined;
  const displayName = name || `Produkt #${productId}`;

  const entry: PriceEntry = {
    id: productId ? `${gameId}:${productId}` : `${gameId}:${buildMatchKey(gameId, displayName, set)}`,
    gameId,
    cardmarketProductId: productId,
    name: displayName,
    set,
    setName: typeof raw.setName === 'string' && raw.setName.trim() ? raw.setName.trim() : undefined,
    number:
      raw.number !== undefined && raw.number !== null && String(raw.number).trim()
        ? String(raw.number).trim()
        : undefined,
    rarity: typeof raw.rarity === 'string' && raw.rarity.trim() ? raw.rarity.trim() : undefined,
    matchKey: buildMatchKey(gameId, displayName, set),
    nameKey: buildNameKey(gameId, displayName),
    updatedAt: Date.now(),
    source,
  };

  let hasPrice = false;
  for (const field of NUMERIC_FIELDS) {
    const value = parseNumber(raw[field] as string | number | undefined);
    if (value !== undefined && value > 0) {
      (entry as unknown as Record<string, number>)[field] = value;
      hasPrice = true;
    }
  }
  return hasPrice || name ? entry : null;
}

/** Erkennt und importiert eine beliebige Preis-Datei (JSON oder CSV). */
export function parsePriceFile(text: string, gameId: GameId, source: string): ImportResult {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return parseJsonPrices(trimmed, gameId, source);
  return parseCsvPrices(trimmed, gameId, source);
}

function parseJsonPrices(text: string, gameId: GameId, source: string): ImportResult {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`JSON konnte nicht gelesen werden: ${(err as Error).message}`);
  }

  let rows: Record<string, unknown>[] = [];
  let format = 'JSON';

  if (Array.isArray(data)) {
    rows = data as Record<string, unknown>[];
    format = 'JSON (Liste)';
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const listKey = ['priceGuides', 'products', 'prices', 'data', 'items', 'entries'].find((k) =>
      Array.isArray(obj[k]),
    );
    if (!listKey) throw new Error('JSON enthält keine erkennbare Liste (priceGuides / products / data).');
    rows = obj[listKey] as Record<string, unknown>[];
    format = `Cardmarket ${listKey}`;
    if (typeof obj.createdAt === 'string') warnings.push(`Cardmarket-Stand: ${obj.createdAt}`);
    if (typeof obj.version === 'number') warnings.push(`Katalog-Version: ${obj.version}`);
  } else {
    throw new Error('Unbekanntes JSON-Format.');
  }

  const entries: PriceEntry[] = [];
  let skipped = 0;
  // Über den Index statt über den Iterator: so lässt sich jede Rohzeile nach der
  // Umwandlung freigeben. Bei Dateien mit >100 000 Zeilen halbiert das den
  // Spitzenspeicher, weil Rohdaten und Ergebnis nicht vollständig nebeneinander
  // liegen müssen.
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const mapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const norm = normalizeHeader(key);
      const field = Object.entries(COLUMN_ALIASES).find(([, aliases]) =>
        aliases.map((a) => a.replace(/[^a-z0-9+]+/g, '')).includes(norm),
      )?.[0];
      if (field) mapped[field] = value;
    }
    // Fehlt die Abkürzung, dient der ausgeschriebene Name als Set
    if (mapped.set === undefined && typeof mapped.setName === 'string') mapped.set = mapped.setName;
    const entry = makeEntry(gameId, mapped, source);
    if (entry) entries.push(entry);
    else skipped++;
    rows[index] = undefined as unknown as Record<string, unknown>;
  }

  if (entries.length && entries.every((e) => e.name.startsWith('Produkt #'))) {
    warnings.push(
      'Diese Datei enthält nur Produkt-IDs ohne Kartennamen. Lade zusätzlich den Produkt-Katalog hoch, um Namen zu ergänzen.',
    );
  }

  return { entries, format, skipped, warnings };
}

function parseCsvPrices(text: string, gameId: GameId, source: string): ImportResult {
  const { header, rows, delimiter } = parseCsv(text);
  const mapping = buildMapping(header);
  if (mapping.name === undefined && mapping.cardmarketProductId === undefined) {
    throw new Error(
      `Keine Namens- oder ID-Spalte gefunden. Erkannte Spalten: ${header.join(', ') || '(keine)'}`,
    );
  }

  const entries: PriceEntry[] = [];
  let skipped = 0;
  for (let line = 0; line < rows.length; line++) {
    const raw: Record<string, unknown> = {};
    for (const [field, index] of Object.entries(mapping)) raw[field] = rows[line][index];
    const entry = makeEntry(gameId, raw, source);
    if (entry) entries.push(entry);
    else skipped++;
    rows[line] = undefined as unknown as string[];
  }

  const readable: Record<string, string> = {};
  for (const [field, index] of Object.entries(mapping)) readable[field] = header[index];

  return {
    entries,
    format: `CSV (Trennzeichen "${delimiter === '\t' ? 'Tab' : delimiter}")`,
    skipped,
    mapping: readable,
    warnings: [],
  };
}

/**
 * Führt neue Einträge mit bestehenden zusammen: bestehende Namen/Sets bleiben
 * erhalten, wenn die neue Datei nur IDs liefert – und umgekehrt.
 */
export function mergeEntries(existing: PriceEntry | undefined, incoming: PriceEntry): PriceEntry {
  if (!existing) return incoming;
  const merged: PriceEntry = { ...existing, ...incoming };
  if (incoming.name.startsWith('Produkt #') && !existing.name.startsWith('Produkt #')) {
    merged.name = existing.name;
    merged.set = existing.set ?? incoming.set;
    merged.setName = existing.setName ?? incoming.setName;
    merged.matchKey = existing.matchKey;
    merged.nameKey = existing.nameKey;
  }
  for (const field of NUMERIC_FIELDS) {
    if (incoming[field] === undefined && existing[field] !== undefined) {
      (merged as unknown as Record<string, unknown>)[field] = existing[field];
    }
  }
  return merged;
}
