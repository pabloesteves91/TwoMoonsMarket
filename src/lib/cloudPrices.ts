import { repo } from '../db';
import { mergeEntries, parsePriceFile } from './cardmarket';
import type { Game, PriceEntry } from '../types';

/**
 * Preisabruf aus dem Web.
 *
 * Ein Wartungslauf (GitHub Actions) lädt die Cardmarket-Preislisten und legt sie
 * zusammen mit einem `index.json` unter `/prices/` neben der App ab. Die App holt
 * sie von dort und importiert sie in die lokale Datenbank – damit funktioniert
 * die Preisaktualisierung auch auf einem Gerät ohne Rechner und ohne Datei-Upload.
 */

export interface PriceManifestFile {
  kind: 'priceGuide' | 'catalog';
  game: string;
  cardmarketGameId: number;
  file: string;
  bytes?: number;
}

export interface PriceManifest {
  createdAt: string;
  files: PriceManifestFile[];
}

const MANIFEST_URL = 'prices/index.json';

/** Liest das Manifest. `null` = auf diesem Host liegen keine Preisdateien. */
export async function fetchPriceManifest(): Promise<PriceManifest | null> {
  try {
    const response = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = (await response.json()) as PriceManifest;
    return Array.isArray(data?.files) && data.files.length > 0 ? data : null;
  } catch {
    return null;
  }
}

export interface CloudImportProgress {
  file: string;
  index: number;
  total: number;
  phase: 'download' | 'parse' | 'save';
}

export interface CloudImportResult {
  imported: number;
  files: number;
  skippedFiles: string[];
  createdAt: string;
}

/**
 * Lädt alle Dateien des Manifests, die zu einem bekannten Spiel gehören,
 * und schreibt sie in die lokale Preisdatenbank.
 */
export async function importPricesFromCloud(
  manifest: PriceManifest,
  games: Game[],
  onProgress?: (progress: CloudImportProgress) => void,
): Promise<CloudImportResult> {
  const gameByCardmarketId = new Map(
    games.filter((game) => game.cardmarketGameId).map((game) => [game.cardmarketGameId!, game.id]),
  );

  const relevant = manifest.files.filter((entry) => gameByCardmarketId.has(entry.cardmarketGameId));
  const skippedFiles: string[] = [];
  let imported = 0;

  // Pro Spiel sammeln, damit Katalog (Namen) und Preisliste (Preise) vor dem
  // Schreiben zu je einem Datensatz verschmelzen.
  const perGame = new Map<string, Map<string, PriceEntry>>();

  for (const [index, entry] of relevant.entries()) {
    const gameId = gameByCardmarketId.get(entry.cardmarketGameId)!;
    onProgress?.({ file: entry.file, index, total: relevant.length, phase: 'download' });

    let text: string;
    try {
      const response = await fetch(`prices/${entry.file}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      text = await response.text();
    } catch {
      skippedFiles.push(entry.file);
      continue;
    }

    onProgress?.({ file: entry.file, index, total: relevant.length, phase: 'parse' });
    try {
      const parsed = parsePriceFile(text, gameId, `Cloud · ${entry.file}`);
      const bucket = perGame.get(gameId) ?? new Map<string, PriceEntry>();
      for (const item of parsed.entries) bucket.set(item.id, mergeEntries(bucket.get(item.id), item));
      perGame.set(gameId, bucket);
    } catch {
      skippedFiles.push(entry.file);
    }
  }

  for (const [gameId, bucket] of perGame) {
    onProgress?.({ file: gameId, index: relevant.length, total: relevant.length, phase: 'save' });
    imported += await repo.upsertPriceEntries([...bucket.values()]);
  }

  return { imported, files: relevant.length - skippedFiles.length, skippedFiles, createdAt: manifest.createdAt };
}
