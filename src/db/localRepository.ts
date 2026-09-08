import type { Game, PriceEntry, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../lib/pricing';
import { mergeEntries } from '../lib/cardmarket';
import { db } from './schema';
import { buildMatchKey, buildNameKey } from '../lib/pricing';
import type { BackupPayload, PriceStats, Repository } from './repository';

export const DEFAULT_GAMES: Game[] = [
  {
    id: 'mtg',
    name: 'Magic: The Gathering',
    short: 'MTG',
    cardmarketGameId: 1,
    cardmarketSlug: 'Magic',
    color: '#c98b3a',
    sortIndex: 0,
  },
  {
    id: 'pokemon',
    name: 'Pokémon',
    short: 'PKM',
    cardmarketGameId: 6,
    cardmarketSlug: 'Pokemon',
    color: '#3a7bc9',
    sortIndex: 1,
  },
];

/** Liest einen beliebigen Preis-Datensatz eines Spiels – für den Zeitstempel des letzten Imports. */
export async function getPriceSample(gameId: string): Promise<PriceEntry | undefined> {
  const sample = await db.prices.where('gameId').equals(gameId).limit(1).toArray();
  return sample[0];
}

async function ensureSeed(): Promise<void> {
  const gameCount = await db.games.count();
  if (gameCount === 0) await db.games.bulkPut(DEFAULT_GAMES);
  const settings = await db.settings.get('settings');
  if (!settings) await db.settings.put(DEFAULT_SETTINGS);
}

export const localRepository: Repository = {
  kind: 'local',

  async getGames() {
    await ensureSeed();
    const games = await db.games.toArray();
    return games.sort((a, b) => a.sortIndex - b.sortIndex);
  },
  async saveGame(game) {
    await db.games.put(game);
  },
  async deleteGame(id) {
    await db.transaction('rw', db.games, db.prices, db.items, async () => {
      await db.games.delete(id);
      await db.prices.where('gameId').equals(id).delete();
      await db.items.where('gameId').equals(id).delete();
    });
  },

  async getSettings() {
    await ensureSeed();
    const settings = await db.settings.get('settings');
    // Fehlende Felder aus Defaults ergänzen (Schema-Erweiterungen)
    return { ...DEFAULT_SETTINGS, ...settings, id: 'settings' } as Settings;
  },
  async saveSettings(settings) {
    await db.settings.put({ ...settings, id: 'settings' });
  },

  async getPriceEntries(gameId) {
    return gameId ? db.prices.where('gameId').equals(gameId).toArray() : db.prices.toArray();
  },
  async countPriceEntries(gameId) {
    return gameId ? db.prices.where('gameId').equals(gameId).count() : db.prices.count();
  },
  async upsertPriceEntries(entries) {
    if (entries.length === 0) return 0;
    let written = 0;
    // In Blöcken schreiben, damit auch grosse Preislisten (>100k Zeilen) laufen
    const chunkSize = 2000;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      await db.transaction('rw', db.prices, async () => {
        const existing = await db.prices.bulkGet(chunk.map((e) => e.id));
        // Derselbe Karte kann aus zwei Quellen kommen (mit und ohne Cardmarket-ID).
        // Über den matchKey wird der bestehende Datensatz gefunden und ersetzt,
        // statt eine zweite Zeile für dieselbe Karte anzulegen.
        const byMatchKey = new Map<string, PriceEntry>();
        const keys = chunk.map((e) => e.matchKey);
        for (const entry of await db.prices.where('matchKey').anyOf(keys).toArray()) {
          if (!byMatchKey.has(entry.matchKey)) byMatchKey.set(entry.matchKey, entry);
        }

        const merged: PriceEntry[] = [];
        const obsolete: string[] = [];
        chunk.forEach((entry, index) => {
          const sameId = existing[index] ?? undefined;
          const sameKey = byMatchKey.get(entry.matchKey);
          if (!sameId && sameKey && sameKey.id !== entry.id) {
            merged.push(mergeEntries(sameKey, entry));
            obsolete.push(sameKey.id);
          } else {
            merged.push(mergeEntries(sameId, entry));
          }
        });
        if (obsolete.length) await db.prices.bulkDelete(obsolete);
        await db.prices.bulkPut(merged);
      });
      written += chunk.length;
    }
    return written;
  },
  async clearPriceEntries(gameId) {
    if (gameId) await db.prices.where('gameId').equals(gameId).delete();
    else await db.prices.clear();
  },
  async searchPriceEntries(query, gameId, limit = 30) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const collection = gameId ? db.prices.where('gameId').equals(gameId) : db.prices.toCollection();
    const results: PriceEntry[] = [];
    await collection.until(() => results.length >= limit).each((entry) => {
      if (results.length >= limit) return;
      if (entry.name.toLowerCase().includes(q)) results.push(entry);
    });
    return results.sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  },

  async resolveEntriesForItems(items) {
    if (items.length === 0) return [];
    const ids = new Set<string>();
    const matchKeys = new Set<string>();
    const nameKeys = new Set<string>();
    for (const item of items) {
      if (item.priceEntryId) ids.add(item.priceEntryId);
      if (item.cardmarketProductId) ids.add(`${item.gameId}:${item.cardmarketProductId}`);
      matchKeys.add(buildMatchKey(item.gameId, item.name, item.set));
      matchKeys.add(buildMatchKey(item.gameId, item.name));
      nameKeys.add(buildNameKey(item.gameId, item.name));
    }
    const [byId, byMatch, byName] = await Promise.all([
      db.prices.bulkGet([...ids]),
      db.prices.where('matchKey').anyOf([...matchKeys]).toArray(),
      db.prices.where('nameKey').anyOf([...nameKeys]).limit(5000).toArray(),
    ]);
    const found = new Map<string, PriceEntry>();
    for (const entry of [...byId, ...byMatch, ...byName]) if (entry) found.set(entry.id, entry);
    return [...found.values()];
  },

  async getPriceStats(): Promise<PriceStats[]> {
    const games = await db.games.toArray();
    const stats: PriceStats[] = [];
    for (const game of games) {
      const collection = db.prices.where('gameId').equals(game.id);
      const count = await collection.count();
      let updatedAt: number | null = null;
      if (count > 0) updatedAt = (await getPriceSample(game.id))?.updatedAt ?? null;
      stats.push({ gameId: game.id, count, updatedAt });
    }
    return stats;
  },

  async getItems() {
    return db.items.toArray();
  },
  async saveItem(item) {
    await db.items.put(item);
  },
  async deleteItem(id) {
    const item = await db.items.get(id);
    await db.items.delete(id);
    if (item?.photoId) await db.photos.delete(item.photoId);
  },

  async getOverrides() {
    return db.overrides.toArray();
  },
  async saveOverride(override) {
    await db.overrides.put(override);
  },
  async deleteOverride(id) {
    await db.overrides.delete(id);
  },

  async getPhoto(id) {
    return db.photos.get(id);
  },
  async savePhoto(photo) {
    await db.photos.put(photo);
  },
  async deletePhoto(id) {
    await db.photos.delete(id);
  },

  async exportAll(): Promise<BackupPayload> {
    const [games, settings, prices, items, overrides, photos] = await Promise.all([
      db.games.toArray(),
      this.getSettings(),
      db.prices.toArray(),
      db.items.toArray(),
      db.overrides.toArray(),
      db.photos.toArray(),
    ]);
    return {
      app: 'twomoons-market',
      version: 1,
      exportedAt: new Date().toISOString(),
      games,
      settings,
      prices,
      items,
      overrides,
      photos,
    };
  },

  async importAll(payload, mode) {
    if (payload.app !== 'twomoons-market') throw new Error('Datei stammt nicht aus TwoMoons Market.');
    await db.transaction('rw', [db.games, db.prices, db.items, db.overrides, db.photos, db.settings], async () => {
      if (mode === 'replace') {
        await Promise.all([
          db.games.clear(),
          db.prices.clear(),
          db.items.clear(),
          db.overrides.clear(),
          db.photos.clear(),
        ]);
      }
      if (payload.games?.length) await db.games.bulkPut(payload.games);
      if (payload.prices?.length) await db.prices.bulkPut(payload.prices);
      if (payload.items?.length) await db.items.bulkPut(payload.items);
      if (payload.overrides?.length) await db.overrides.bulkPut(payload.overrides);
      if (payload.photos?.length) await db.photos.bulkPut(payload.photos);
      if (payload.settings) await db.settings.put({ ...payload.settings, id: 'settings' });
    });
  },

  async resetAll() {
    await db.transaction('rw', [db.games, db.prices, db.items, db.overrides, db.photos, db.settings], async () => {
      await Promise.all([
        db.games.clear(),
        db.prices.clear(),
        db.items.clear(),
        db.overrides.clear(),
        db.photos.clear(),
        db.settings.clear(),
      ]);
    });
    await ensureSeed();
  },
};
