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

/** Kurs, den der wöchentliche Lauf mitliefert. */
export interface PublishedRate {
  eurToChf: number;
  source: string;
  date: string;
  fetchedAt?: string;
}

export interface PriceManifest {
  createdAt: string;
  files: PriceManifestFile[];
  rates?: PublishedRate;
}

const MANIFEST_URL = 'prices/index.json';

/**
 * Stand der zuletzt übernommenen Preisliste, je Gerät.
 *
 * Die Preise liegen im Web; jedes Gerät hält nur eine Kopie zum schnellen
 * Nachschlagen. Dieser Merker sagt, welcher Stand das ist – stimmt er nicht mehr
 * mit dem veröffentlichten überein, holt die App die neue Fassung von selbst.
 */
// Die Zahl am Ende ist der Aufbau der Blöcke, nicht der Preisstand. Seit die
// Einträge auch im Block ihres Set-Kürzels liegen (Suche "M2A 031"), muss jedes
// Gerät die Preisliste einmal neu einlesen – ein neuer Schlüssel erledigt das
// von selbst, ohne dass jemand etwas anklicken muss.
const VERSION_KEY = 'twomoons.prices.version.2';

export function storedPriceVersion(): string | null {
  try {
    return localStorage.getItem(VERSION_KEY);
  } catch {
    return null;
  }
}

export function rememberPriceVersion(createdAt: string): void {
  try {
    localStorage.setItem(VERSION_KEY, createdAt);
  } catch {
    // Privater Modus o.ä. – dann wird beim nächsten Start erneut geladen
  }
}

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

  // Nach Spiel gruppiert und je Spiel sofort geschrieben: so liegen nie die
  // Daten beider Spiele gleichzeitig im Speicher. Bei ~200 000 Karten macht das
  // auf dem Handy den Unterschied.
  const byGame = new Map<string, PriceManifestFile[]>();
  for (const entry of relevant) {
    const gameId = gameByCardmarketId.get(entry.cardmarketGameId)!;
    byGame.set(gameId, [...(byGame.get(gameId) ?? []), entry]);
  }

  let processed = 0;
  for (const [gameId, files] of byGame) {
    // Katalog und Preisliste eines Spiels gehören über die Produkt-ID zusammen
    let bucket: Map<string, PriceEntry> | null = new Map<string, PriceEntry>();

    for (const entry of files) {
      onProgress?.({ file: entry.file, index: processed, total: relevant.length, phase: 'download' });
      let text: string;
      try {
        const response = await fetch(`prices/${entry.file}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        text = await response.text();
      } catch {
        skippedFiles.push(entry.file);
        processed++;
        continue;
      }

      onProgress?.({ file: entry.file, index: processed, total: relevant.length, phase: 'parse' });
      try {
        const parsed = parsePriceFile(text, gameId, `Cloud · ${entry.file}`);
        for (const item of parsed.entries) bucket.set(item.id, mergeEntries(bucket.get(item.id), item));
      } catch {
        skippedFiles.push(entry.file);
      }
      processed++;
    }

    if (bucket.size > 0) {
      onProgress?.({ file: gameId, index: processed, total: relevant.length, phase: 'save' });
      // Der Abruf liefert die vollständige Liste des Spiels – Ersetzen ist hier
      // deutlich schneller, als jede Zeile einzeln abzugleichen.
      const entries = [...bucket.values()];
      bucket = null;
      imported += await repo.upsertPriceEntries(entries, { mode: 'replace', gameId });
    }
  }

  if (skippedFiles.length === 0) rememberPriceVersion(manifest.createdAt);
  return { imported, files: relevant.length - skippedFiles.length, skippedFiles, createdAt: manifest.createdAt };
}

/**
 * Prüft, ob eine neuere Preisliste veröffentlicht wurde.
 * Rückgabe `null`, wenn nichts zu tun ist.
 */
export async function findNewerPrices(): Promise<PriceManifest | null> {
  const manifest = await fetchPriceManifest();
  if (!manifest) return null;
  return manifest.createdAt === storedPriceVersion() ? null : manifest;
}

/**
 * Holt nur den veröffentlichten Kurs.
 *
 * Getrennt vom Preisabgleich, weil der Kurs ein paar Byte gross ist und auch
 * dann gelten soll, wenn die Preisliste unverändert blieb.
 */
export async function fetchPublishedRate(): Promise<PublishedRate | null> {
  const manifest = await fetchPriceManifest();
  const rate = manifest?.rates;
  return rate && Number.isFinite(rate.eurToChf) && rate.eurToChf > 0 ? rate : null;
}
