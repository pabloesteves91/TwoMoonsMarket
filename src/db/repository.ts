import type { Game, InventoryItem, Photo, PriceEntry, RuleOverride, Settings } from '../types';

/**
 * Datenzugriff der App. Aktuell erfüllt `localRepository` (IndexedDB) diese
 * Schnittstelle; für den späteren Firebase-Betrieb wird ein zweites Modul
 * mit derselben Signatur implementiert (siehe src/firebase/README.md).
 */
export interface Repository {
  readonly kind: 'local' | 'firebase';

  getGames(): Promise<Game[]>;
  saveGame(game: Game): Promise<void>;
  deleteGame(id: string): Promise<void>;

  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;

  getPriceEntries(gameId?: string): Promise<PriceEntry[]>;
  countPriceEntries(gameId?: string): Promise<number>;
  /**
   * Schreibt Preis-Datensätze.
   *
   * `merge` (Standard) führt sie mit vorhandenen zusammen – nötig, wenn Katalog
   * und Preisliste als getrennte Dateien hochgeladen werden.
   * `replace` ersetzt die Liste eines Spiels vollständig und kommt ohne
   * Lesezugriffe aus; das ist der Weg für den Abruf einer kompletten Liste.
   */
  upsertPriceEntries(entries: PriceEntry[], options?: UpsertOptions): Promise<number>;
  clearPriceEntries(gameId?: string): Promise<void>;
  searchPriceEntries(query: string, gameId?: string, limit?: number): Promise<PriceEntry[]>;
  /**
   * Lädt nur die Preis-Datensätze, die zu den übergebenen Bestandseinträgen passen.
   * Verhindert, dass eine komplette Preisliste (>100k Zeilen) in den Speicher muss.
   */
  resolveEntriesForItems(items: InventoryItem[]): Promise<PriceEntry[]>;
  /** Anzahl Datensätze und Zeitpunkt des letzten Imports je Spiel. */
  getPriceStats(): Promise<PriceStats[]>;

  getItems(): Promise<InventoryItem[]>;
  saveItem(item: InventoryItem): Promise<void>;
  deleteItem(id: string): Promise<void>;

  getOverrides(): Promise<RuleOverride[]>;
  saveOverride(override: RuleOverride): Promise<void>;
  deleteOverride(id: string): Promise<void>;

  getPhoto(id: string): Promise<Photo | undefined>;
  savePhoto(photo: Photo): Promise<void>;
  deletePhoto(id: string): Promise<void>;

  exportAll(): Promise<BackupPayload>;
  importAll(payload: BackupPayload, mode: 'replace' | 'merge'): Promise<void>;
  resetAll(): Promise<void>;
}

export interface UpsertOptions {
  mode?: 'merge' | 'replace';
  /** Bei `replace` erforderlich: das Spiel, dessen Liste ersetzt wird. */
  gameId?: string;
}

export interface PriceStats {
  gameId: string;
  count: number;
  updatedAt: number | null;
}

export interface BackupPayload {
  app: 'twomoons-market';
  version: 1;
  exportedAt: string;
  games: Game[];
  settings: Settings;
  /**
   * Preislisten sind seit Version 0.2 nicht mehr Teil des Backups: sie sind mit
   * einem Tipp neu abrufbar und hätten die Datei um zweistellige Megabyte
   * aufgebläht. Ältere Backups bringen sie noch mit und werden weiter gelesen.
   */
  prices?: PriceEntry[];
  items: InventoryItem[];
  overrides: RuleOverride[];
  photos: Photo[];
}
