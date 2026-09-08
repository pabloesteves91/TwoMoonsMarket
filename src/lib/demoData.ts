import { repo } from '../db';
import { buildMatchKey, buildNameKey } from './pricing';
import { uid } from './format';
import type { InventoryItem, PriceEntry } from '../types';

/**
 * Kleiner Beispieldatensatz, um die App ohne Cardmarket-Import ausprobieren zu
 * können. Die Preise sind erfunden und dienen nur der Demonstration.
 */
const DEMO_PRICES: { gameId: string; name: string; set: string; trend: number; foilTrend?: number }[] = [
  { gameId: 'mtg', name: 'Lightning Bolt', set: 'Beta', trend: 289.5, foilTrend: 0 },
  { gameId: 'mtg', name: 'Ragavan, Nimble Pilferer', set: 'Modern Horizons 2', trend: 42.8, foilTrend: 61.2 },
  { gameId: 'mtg', name: 'Sheoldred, the Apocalypse', set: 'Dominaria United', trend: 58.1, foilTrend: 88.4 },
  { gameId: 'mtg', name: 'Counterspell', set: 'Modern Horizons 2', trend: 1.35, foilTrend: 3.1 },
  { gameId: 'mtg', name: 'Llanowar Elves', set: 'Dominaria', trend: 0.21, foilTrend: 0.85 },
  { gameId: 'pokemon', name: 'Charizard ex', set: 'Obsidian Flames', trend: 21.4, foilTrend: 34.9 },
  { gameId: 'pokemon', name: 'Pikachu VMAX', set: 'Vivid Voltage', trend: 12.6, foilTrend: 18.2 },
  { gameId: 'pokemon', name: 'Mew ex', set: 'Paldean Fates', trend: 8.75, foilTrend: 14.3 },
  { gameId: 'pokemon', name: 'Iono', set: 'Paldea Evolved', trend: 4.2, foilTrend: 9.8 },
];

const DEMO_ITEMS: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>[] = [
  { gameId: 'mtg', name: 'Ragavan, Nimble Pilferer', set: 'Modern Horizons 2', condition: 'NM', language: 'EN', foil: false, quantity: 2, purchasePrice: 32, location: 'Vitrine' },
  { gameId: 'mtg', name: 'Sheoldred, the Apocalypse', set: 'Dominaria United', condition: 'NM', language: 'DE', foil: true, quantity: 1, purchasePrice: 70, location: 'Vitrine' },
  { gameId: 'mtg', name: 'Counterspell', set: 'Modern Horizons 2', condition: 'EX', language: 'EN', foil: false, quantity: 12, purchasePrice: 0.8, location: 'Box 2' },
  { gameId: 'mtg', name: 'Llanowar Elves', set: 'Dominaria', condition: 'NM', language: 'DE', foil: false, quantity: 40, purchasePrice: 0.1, location: 'Box 1' },
  { gameId: 'pokemon', name: 'Charizard ex', set: 'Obsidian Flames', condition: 'NM', language: 'EN', foil: true, quantity: 3, purchasePrice: 24, location: 'Vitrine' },
  { gameId: 'pokemon', name: 'Iono', set: 'Paldea Evolved', condition: 'NM', language: 'DE', foil: false, quantity: 8, purchasePrice: 2.5, location: 'Box 5' },
];

export async function loadDemoData(): Promise<void> {
  const now = Date.now();
  const entries: PriceEntry[] = DEMO_PRICES.map((price, index) => ({
    id: `${price.gameId}:demo-${index}`,
    gameId: price.gameId,
    name: price.name,
    set: price.set,
    matchKey: buildMatchKey(price.gameId, price.name, price.set),
    nameKey: buildNameKey(price.gameId, price.name),
    trend: price.trend,
    avg: Math.round(price.trend * 1.04 * 100) / 100,
    avg7: Math.round(price.trend * 0.98 * 100) / 100,
    avg30: Math.round(price.trend * 0.94 * 100) / 100,
    low: Math.round(price.trend * 0.72 * 100) / 100,
    germanProLow: Math.round(price.trend * 0.85 * 100) / 100,
    foilTrend: price.foilTrend || undefined,
    foilSell: price.foilTrend ? Math.round(price.foilTrend * 1.05 * 100) / 100 : undefined,
    foilLow: price.foilTrend ? Math.round(price.foilTrend * 0.75 * 100) / 100 : undefined,
    updatedAt: now,
    source: 'Demo-Daten',
  }));
  await repo.upsertPriceEntries(entries);

  // Bereits vorhandene Demo-Einträge nicht ein zweites Mal anlegen
  const existing = await repo.getItems();
  const key = (item: { name: string; set?: string; foil: boolean; condition: string }) =>
    `${item.name}|${item.set ?? ''}|${item.foil}|${item.condition}`;
  const known = new Set(existing.map(key));

  for (const item of DEMO_ITEMS) {
    if (known.has(key(item))) continue;
    await repo.saveItem({ ...item, id: uid('item_'), createdAt: now, updatedAt: now });
  }
}
