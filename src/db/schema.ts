import Dexie, { type Table } from 'dexie';
import type { Game, InventoryItem, Photo, PriceBucket, PriceMeta, RuleOverride, Settings } from '../types';

/**
 * Lokale Datenbank (IndexedDB). Sie ist absichtlich hinter dem Repository in
 * `src/db/repository.ts` versteckt, damit später ein Firestore-Backend
 * dieselbe Schnittstelle erfüllen kann.
 */
export class TwoMoonsDb extends Dexie {
  games!: Table<Game, string>;
  priceBuckets!: Table<PriceBucket, string>;
  priceMeta!: Table<PriceMeta, string>;
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

    /**
     * Version 2 speichert die Preislisten nicht mehr zeilenweise.
     *
     * Gemessen in Chromium: 198 000 Einzelzeilen zu schreiben dauert allein
     * wegen der Indexpflege über drei Minuten – für einen Preisabruf auf dem
     * Handy unbrauchbar. Stattdessen liegen die Einträge jetzt in Blöcken:
     * ein Block je Wortanfang (drei Zeichen), das sind einige tausend Zeilen
     * statt hunderttausender.
     *
     * Ein Eintrag liegt in jedem Block seiner Wörter, damit die Suche nach
     * "bolt" auch "Lightning Bolt" findet.
     */
    this.version(2)
      .stores({
        prices: null,
        priceBuckets: 'id, gameId',
        priceMeta: 'gameId',
      })
      .upgrade(async (tx) => {
        // Die alte Tabelle wird verworfen; die Preise sind mit einem Tipp
        // unter "Preise" wieder da und der Neuaufbau ist schneller als eine
        // Umwandlung von 200 000 Zeilen.
        await tx.table('priceMeta').clear();
      });
  }
}

export const db = new TwoMoonsDb();
