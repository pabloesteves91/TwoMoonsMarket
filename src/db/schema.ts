import Dexie, { type Table } from 'dexie';
import type { Game, InventoryItem, Photo, PriceEntry, RuleOverride, Settings } from '../types';

/**
 * Lokale Datenbank (IndexedDB). Sie ist absichtlich hinter dem Repository in
 * `src/db/repository.ts` versteckt, damit später ein Firestore-Backend
 * dieselbe Schnittstelle erfüllen kann.
 */
export class TwoMoonsDb extends Dexie {
  games!: Table<Game, string>;
  prices!: Table<PriceEntry, string>;
  items!: Table<InventoryItem, string>;
  overrides!: Table<RuleOverride, string>;
  photos!: Table<Photo, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('twomoons-market');
    this.version(1).stores({
      games: 'id, sortIndex',
      prices: 'id, gameId, matchKey, nameKey, name, set, cardmarketProductId',
      items: 'id, gameId, name, set, condition, language, foil, priceEntryId, updatedAt',
      overrides: 'id, scope, gameId',
      photos: 'id',
      settings: 'id',
    });
  }
}

export const db = new TwoMoonsDb();
