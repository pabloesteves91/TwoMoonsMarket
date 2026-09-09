import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  type CollectionReference,
  type DocumentData,
} from 'firebase/firestore';
import { getDb } from './config';
import { WORKSPACE_ID } from './env';
import { DEFAULT_GAMES, getPriceMetaMap, localRepository } from '../db/localRepository';
import { DEFAULT_SETTINGS, withDefaults } from '../lib/pricing';
import type { BackupPayload, PriceStats, Repository } from '../db/repository';
import type { Game, InventoryItem, Photo, RuleOverride, Sale, Settings } from '../types';

/**
 * Firestore-Backend.
 *
 * Bestand, Regeln, Spiele, Fotos und Einstellungen liegen im gemeinsamen
 * Arbeitsbereich der Firma – jedes angemeldete Teammitglied sieht denselben Stand.
 *
 * Die Preislisten bleiben bewusst lokal (IndexedDB): pro Spiel sind das schnell
 * über 50 000 Datensätze, die in Firestore jedes Mal einzeln geschrieben werden
 * müssten. Sie sind ausserdem für alle identisch und jederzeit neu importierbar.
 */

const workspace = () => doc(getDb(), 'workspaces', WORKSPACE_ID);
const col = (name: string): CollectionReference<DocumentData> => collection(workspace(), name);

/** Firestore akzeptiert keine `undefined`-Werte – diese Felder werden entfernt. */
function clean<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    result[key] =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? clean(entry as Record<string, unknown>)
        : entry;
  }
  return result as T;
}

async function readAll<T>(name: string): Promise<T[]> {
  const snapshot = await getDocs(col(name));
  return snapshot.docs.map((entry) => entry.data() as T);
}

/** Schreibt beliebig viele Dokumente in Batches (Firestore-Limit: 500 pro Batch). */
async function writeMany<T extends { id: string }>(name: string, docs: T[]): Promise<void> {
  const db = getDb();
  for (let i = 0; i < docs.length; i += 450) {
    const batch = writeBatch(db);
    for (const entry of docs.slice(i, i + 450)) {
      batch.set(doc(col(name), entry.id), clean(entry as unknown as Record<string, unknown>));
    }
    await batch.commit();
  }
}

async function clearCollection(name: string): Promise<void> {
  const snapshot = await getDocs(col(name));
  const db = getDb();
  for (let i = 0; i < snapshot.docs.length; i += 450) {
    const batch = writeBatch(db);
    for (const entry of snapshot.docs.slice(i, i + 450)) batch.delete(entry.ref);
    await batch.commit();
  }
}

export const firebaseRepository: Repository = {
  kind: 'firebase',

  async getGames() {
    const games = await readAll<Game>('games');
    if (games.length === 0) {
      // Erster Start des Arbeitsbereichs: Standardspiele anlegen
      await writeMany('games', DEFAULT_GAMES);
      return [...DEFAULT_GAMES];
    }
    return games.sort((a, b) => a.sortIndex - b.sortIndex);
  },
  async saveGame(game) {
    await setDoc(doc(col('games'), game.id), clean(game as unknown as Record<string, unknown>));
  },
  async deleteGame(id) {
    await deleteDoc(doc(col('games'), id));
    const items = await readAll<InventoryItem>('items');
    const affected = items.filter((item) => item.gameId === id);
    const db = getDb();
    for (let i = 0; i < affected.length; i += 450) {
      const batch = writeBatch(db);
      for (const item of affected.slice(i, i + 450)) batch.delete(doc(col('items'), item.id));
      await batch.commit();
    }
    await localRepository.clearPriceEntries(id);
  },

  async getSettings() {
    const snapshot = await getDoc(doc(col('settings'), 'settings'));
    if (!snapshot.exists()) {
      await setDoc(doc(col('settings'), 'settings'), DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }
    const { settings, migrated } = withDefaults(snapshot.data() as Partial<Settings>);
    // Die Umstellung einmal festschreiben, sonst käme sie bei jedem Start wieder
    if (migrated) await setDoc(doc(col('settings'), 'settings'), settings);
    return settings;
  },
  async saveSettings(settings) {
    await setDoc(
      doc(col('settings'), 'settings'),
      clean({ ...settings, id: 'settings' } as unknown as Record<string, unknown>),
    );
  },

  // --- Preislisten bleiben lokal ---
  getPriceEntries: (gameId) => localRepository.getPriceEntries(gameId),
  countPriceEntries: (gameId) => localRepository.countPriceEntries(gameId),
  upsertPriceEntries: (entries, options) => localRepository.upsertPriceEntries(entries, options),
  clearPriceEntries: (gameId) => localRepository.clearPriceEntries(gameId),
  searchPriceEntries: (query, gameId, limit) => localRepository.searchPriceEntries(query, gameId, limit),
  resolveEntriesForItems: (items) => localRepository.resolveEntriesForItems(items),

  async getPriceStats(): Promise<PriceStats[]> {
    // Spiele kommen aus Firestore, Anzahl und Stand aus der lokalen Preisliste
    const games = await this.getGames();
    const meta = await getPriceMetaMap();
    return games.map((game) => ({
      gameId: game.id,
      count: meta.get(game.id)?.count ?? 0,
      updatedAt: meta.get(game.id)?.updatedAt ?? null,
    }));
  },

  async getItems() {
    return readAll<InventoryItem>('items');
  },
  async saveItem(item) {
    await setDoc(doc(col('items'), item.id), clean(item as unknown as Record<string, unknown>));
  },
  async deleteItem(id) {
    const snapshot = await getDoc(doc(col('items'), id));
    const photoId = (snapshot.data() as InventoryItem | undefined)?.photoId;
    await deleteDoc(doc(col('items'), id));
    if (photoId) await deleteDoc(doc(col('photos'), photoId));
  },

  async getSales() {
    const sales = await readAll<Sale>('sales');
    return sales.sort((a, b) => b.soldAt - a.soldAt);
  },
  async saveSale(sale) {
    await setDoc(doc(col('sales'), sale.id), clean(sale as unknown as Record<string, unknown>));
  },
  async deleteSale(id) {
    await deleteDoc(doc(col('sales'), id));
  },

  async getOverrides() {
    return readAll<RuleOverride>('overrides');
  },
  async saveOverride(override) {
    await setDoc(doc(col('overrides'), override.id), clean(override as unknown as Record<string, unknown>));
  },
  async deleteOverride(id) {
    await deleteDoc(doc(col('overrides'), id));
  },

  async getPhoto(id) {
    const snapshot = await getDoc(doc(col('photos'), id));
    return snapshot.exists() ? (snapshot.data() as Photo) : undefined;
  },
  async savePhoto(photo) {
    // Ein Firestore-Dokument fasst maximal 1 MiB; die Bilder werden vorher skaliert.
    if (photo.dataUrl.length > 900_000) {
      throw new Error('Das Foto ist zu gross für die Cloud-Ablage. Bitte ein kleineres Bild wählen.');
    }
    await setDoc(doc(col('photos'), photo.id), photo);
  },
  async deletePhoto(id) {
    await deleteDoc(doc(col('photos'), id));
  },

  async exportAll(): Promise<BackupPayload> {
    const [games, settings, items, sales, overrides, photos] = await Promise.all([
      readAll<Game>('games'),
      this.getSettings(),
      readAll<InventoryItem>('items'),
      readAll<Sale>('sales'),
      readAll<RuleOverride>('overrides'),
      readAll<Photo>('photos'),
    ]);
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
    if (mode === 'replace') {
      await Promise.all([
        clearCollection('games'),
        clearCollection('items'),
        clearCollection('sales'),
        clearCollection('overrides'),
        clearCollection('photos'),
      ]);
    }
    if (payload.games?.length) await writeMany('games', payload.games);
    if (payload.items?.length) await writeMany('items', payload.items);
    if (payload.sales?.length) await writeMany('sales', payload.sales);
    if (payload.overrides?.length) await writeMany('overrides', payload.overrides);
    if (payload.photos?.length) await writeMany('photos', payload.photos);
    if (payload.settings) await this.saveSettings({ ...payload.settings, id: 'settings' });
    // Preislisten liegen lokal
    if (payload.prices?.length) {
      if (mode === 'replace') await localRepository.clearPriceEntries();
      await localRepository.upsertPriceEntries(payload.prices);
    }
  },

  async resetAll() {
    await Promise.all([
      clearCollection('games'),
      clearCollection('items'),
      clearCollection('sales'),
      clearCollection('overrides'),
      clearCollection('photos'),
      clearCollection('settings'),
    ]);
    await localRepository.clearPriceEntries();
  },
};
