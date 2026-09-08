import type { Game, PriceBucket, PriceEntry, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../lib/pricing';
import { mergeEntries } from '../lib/cardmarket';
import { db } from './schema';
import { buildMatchKey, buildNameKey, bucketsOf, normalize, primaryBucketOf } from '../lib/pricing';
import type { BackupPayload, PriceStats, Repository, UpsertOptions } from './repository';

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

const bucketId = (gameId: string, bucketKey: string) => `${gameId}:${bucketKey}`;

/**
 * Kennzahlen der lokalen Preislisten je Spiel. Auch im Firestore-Betrieb liegen
 * die Preise lokal, dort kommt die Spieleliste aber aus der Cloud – deshalb ist
 * das hier von der lokalen Spieletabelle unabhängig.
 */
export async function getPriceMetaMap(): Promise<Map<string, { count: number; updatedAt: number }>> {
  const meta = await db.priceMeta.toArray();
  return new Map(meta.map((entry) => [entry.gameId, { count: entry.count, updatedAt: entry.updatedAt }]));
}

/** Liest die Blöcke zu einer Menge von Blockschlüsseln. */
async function readBuckets(gameId: string, keys: Iterable<string>): Promise<PriceEntry[]> {
  const ids = [...new Set([...keys].map((key) => bucketId(gameId, key)))];
  const buckets = await db.priceBuckets.bulkGet(ids);
  const entries: PriceEntry[] = [];
  for (const bucket of buckets) if (bucket) entries.push(...bucket.entries);
  return entries;
}

/** Verteilt Einträge auf ihre Blöcke – ein Eintrag liegt in jedem Block seiner Wörter. */
function groupIntoBuckets(entries: PriceEntry[]): Map<string, PriceEntry[]> {
  const buckets = new Map<string, PriceEntry[]>();
  for (const entry of entries) {
    for (const key of bucketsOf(entry.name)) {
      const list = buckets.get(key);
      if (list) list.push(entry);
      else buckets.set(key, [entry]);
    }
  }
  return buckets;
}

async function writeBuckets(gameId: string, buckets: Map<string, PriceEntry[]>): Promise<void> {
  const rows: PriceBucket[] = [...buckets].map(([bucketKey, entries]) => ({
    id: bucketId(gameId, bucketKey),
    gameId,
    bucketKey,
    entries,
  }));
  for (let i = 0; i < rows.length; i += 200) await db.priceBuckets.bulkPut(rows.slice(i, i + 200));
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
    await db.transaction('rw', [db.games, db.priceBuckets, db.priceMeta, db.items], async () => {
      await db.games.delete(id);
      await db.priceBuckets.where('gameId').equals(id).delete();
      await db.priceMeta.delete(id);
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
    const buckets = gameId
      ? await db.priceBuckets.where('gameId').equals(gameId).toArray()
      : await db.priceBuckets.toArray();
    // Ein Eintrag liegt in mehreren Blöcken – für den Export wird entdoppelt
    const unique = new Map<string, PriceEntry>();
    for (const bucket of buckets) for (const entry of bucket.entries) unique.set(entry.id, entry);
    return [...unique.values()];
  },

  async countPriceEntries(gameId) {
    if (gameId) return (await db.priceMeta.get(gameId))?.count ?? 0;
    const all = await db.priceMeta.toArray();
    return all.reduce((sum, meta) => sum + meta.count, 0);
  },

  async upsertPriceEntries(entries, options: UpsertOptions = {}) {
    if (entries.length === 0) return 0;

    // Nach Spiel trennen, damit Kennzahlen und Ersetzen je Spiel greifen
    const perGame = new Map<string, PriceEntry[]>();
    for (const entry of entries) {
      const list = perGame.get(entry.gameId);
      if (list) list.push(entry);
      else perGame.set(entry.gameId, [entry]);
    }

    let written = 0;
    for (const [gameId, list] of perGame) {
      const incoming = groupIntoBuckets(list);

      if (options.mode !== 'replace') {
        // Zusammenführen: nur die betroffenen Blöcke lesen und je Eintrag mischen
        const existing = await db.priceBuckets.bulkGet([...incoming.keys()].map((key) => bucketId(gameId, key)));
        [...incoming.keys()].forEach((key, index) => {
          const previous = existing[index];
          if (!previous) return;
          const merged = new Map(previous.entries.map((entry) => [entry.id, entry]));
          for (const entry of incoming.get(key)!) merged.set(entry.id, mergeEntries(merged.get(entry.id), entry));
          incoming.set(key, [...merged.values()]);
        });
      } else {
        await db.priceBuckets.where('gameId').equals(gameId).delete();
      }

      await writeBuckets(gameId, incoming);

      const unique = new Set<string>();
      for (const bucketEntries of incoming.values()) for (const entry of bucketEntries) unique.add(entry.id);
      const previous = options.mode === 'replace' ? 0 : ((await db.priceMeta.get(gameId))?.count ?? 0);
      await db.priceMeta.put({
        gameId,
        count: Math.max(previous, unique.size),
        updatedAt: Date.now(),
        source: list[0]?.source,
      });
      written += list.length;
    }
    return written;
  },

  async clearPriceEntries(gameId) {
    if (gameId) {
      await db.priceBuckets.where('gameId').equals(gameId).delete();
      await db.priceMeta.delete(gameId);
    } else {
      await db.priceBuckets.clear();
      await db.priceMeta.clear();
    }
  },

  async searchPriceEntries(query, gameId, limit = 30) {
    const normalized = normalize(query);
    if (!normalized) return [];
    const tokens = normalized.split(' ').filter((token) => token.length > 0);
    const games = gameId ? [gameId] : (await db.games.toArray()).map((game) => game.id);

    // Einträge liegen im Block jedes ihrer Wörter. Als Einstieg dient das
    // längste Wort der Eingabe – es ist am trennschärfsten.
    const probe = tokens.reduce((longest, token) => (token.length > longest.length ? token : longest));
    const prefix = probe.slice(0, 3);

    const matches = (name: string): boolean => {
      const normalizedName = normalize(name);
      if (normalizedName.startsWith(normalized)) return true;
      const words = normalizedName.split(' ');
      return tokens.every((token) => words.some((word) => word.startsWith(token)));
    };

    const found = new Map<string, PriceEntry>();
    for (const game of games) {
      const buckets =
        prefix.length >= 3
          ? await db.priceBuckets.bulkGet([bucketId(game, prefix)])
          : await db.priceBuckets.where('id').startsWith(bucketId(game, prefix)).toArray();

      for (const bucket of buckets) {
        if (!bucket) continue;
        for (const entry of bucket.entries) {
          if (found.has(entry.id) || !matches(entry.name)) continue;
          found.set(entry.id, entry);
          if (found.size >= limit * 8) break;
        }
      }
    }

    return [...found.values()]
      .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
      .slice(0, limit);
  },

  async resolveEntriesForItems(items) {
    if (items.length === 0) return [];
    const perGame = new Map<string, Set<string>>();
    for (const item of items) {
      const keys = perGame.get(item.gameId) ?? new Set<string>();
      keys.add(primaryBucketOf(item.name));
      perGame.set(item.gameId, keys);
    }

    const wanted = new Set<string>();
    for (const item of items) {
      wanted.add(buildMatchKey(item.gameId, item.name, item.set));
      wanted.add(buildMatchKey(item.gameId, item.name));
      wanted.add(buildNameKey(item.gameId, item.name));
    }

    const found = new Map<string, PriceEntry>();
    for (const [gameId, keys] of perGame) {
      for (const entry of await readBuckets(gameId, keys)) {
        if (wanted.has(entry.matchKey) || wanted.has(entry.nameKey)) found.set(entry.id, entry);
      }
    }
    return [...found.values()];
  },

  async getPriceStats(): Promise<PriceStats[]> {
    const games = await db.games.toArray();
    const meta = await getPriceMetaMap();
    return games.map((game) => ({
      gameId: game.id,
      count: meta.get(game.id)?.count ?? 0,
      updatedAt: meta.get(game.id)?.updatedAt ?? null,
    }));
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

  async getSales() {
    const sales = await db.sales.toArray();
    return sales.sort((a, b) => b.soldAt - a.soldAt);
  },
  async saveSale(sale) {
    await db.sales.put(sale);
  },
  async deleteSale(id) {
    await db.sales.delete(id);
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
    const [games, settings, items, overrides, photos] = await Promise.all([
      db.games.toArray(),
      this.getSettings(),
      db.items.toArray(),
      db.overrides.toArray(),
      db.photos.toArray(),
    ]);
    const sales = await db.sales.toArray();
    return {
      app: 'twomoons-market',
      version: 1,
      exportedAt: new Date().toISOString(),
      games,
      settings,
      items,
      sales,
      overrides,
      photos,
    };
  },

  async importAll(payload, mode) {
    if (payload.app !== 'twomoons-market') throw new Error('Datei stammt nicht aus TwoMoons Market.');
    await db.transaction('rw', [db.games, db.items, db.sales, db.overrides, db.photos, db.settings], async () => {
      if (mode === 'replace') {
        await Promise.all([
          db.games.clear(),
          db.items.clear(),
          db.sales.clear(),
          db.overrides.clear(),
          db.photos.clear(),
        ]);
      }
      if (payload.games?.length) await db.games.bulkPut(payload.games);
      if (payload.items?.length) await db.items.bulkPut(payload.items);
      if (payload.sales?.length) await db.sales.bulkPut(payload.sales);
      if (payload.overrides?.length) await db.overrides.bulkPut(payload.overrides);
      if (payload.photos?.length) await db.photos.bulkPut(payload.photos);
      if (payload.settings) await db.settings.put({ ...payload.settings, id: 'settings' });
    });

    // Preise liegen in Blöcken und laufen deshalb über den regulären Schreibweg
    if (payload.prices?.length) {
      if (mode === 'replace') await this.clearPriceEntries();
      await this.upsertPriceEntries(payload.prices);
    }
  },

  async resetAll() {
    await db.transaction(
      'rw',
      [db.games, db.priceBuckets, db.priceMeta, db.items, db.sales, db.overrides, db.photos, db.settings],
      async () => {
        await Promise.all([
          db.games.clear(),
          db.priceBuckets.clear(),
          db.priceMeta.clear(),
          db.items.clear(),
          db.sales.clear(),
          db.overrides.clear(),
          db.photos.clear(),
          db.settings.clear(),
        ]);
      },
    );
    await ensureSeed();
  },
};
