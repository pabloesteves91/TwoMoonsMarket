#!/usr/bin/env node
/**
 * Ergänzt Magic-Karten um Set-Kürzel, Sammlernummer und Seltenheit.
 *
 * Der Cardmarket-Katalog führt die Edition nur als Nummer, und der API-Zugang
 * dorthin ist an den Verkäufer-Status gekoppelt. Scryfall ist frei zugänglich,
 * braucht keine Anmeldung – und führt zu jeder Ausgabe die
 * Cardmarket-Produktnummer (`cardmarket_id`) mit. Damit lässt sich beides
 * direkt verbinden.
 *
 * Die Sammeldatei ist mehrere hundert Megabyte gross und wird deshalb zeilenweise
 * verarbeitet, statt sie am Stück in den Speicher zu laden.
 *
 * Nutzung: node scripts/enrich-scryfall.mjs [ordner]   (Standard: dist/prices)
 *
 * Datenquelle: Scryfall (https://scryfall.com), frei nutzbar mit Namensnennung.
 */

import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { argv, env, exit } from 'node:process';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

const dir = argv[2] ?? 'dist/prices';
// Nur für Testläufe umgestellt, im Betrieb immer Scryfall selbst
const API = env.SCRYFALL_API ?? 'https://api.scryfall.com';
// Nur ASCII: ein Umlaut im User-Agent führt zu einer abgewiesenen Anfrage
const UA = 'TwoMoonsMarket/0.1 (+https://github.com/pabloesteves91/TwoMoonsMarket)';

/**
 * Sucht die Download-Adresse in einem Eintrag der Sammeldatei-Liste.
 *
 * Scryfall hat die Felder über die Zeit umbenannt: früher `download_uri`,
 * inzwischen `jsonl_download_uri`. Deshalb werden alle bekannten Namen
 * geprüft, und zur Sicherheit jedes Feld, das auf eine Adresse hindeutet.
 */
function addressOf(entry) {
  if (!entry || typeof entry !== 'object') return undefined;
  const known = [
    entry.download_uri,
    entry.jsonl_download_uri,
    entry.downloadUri,
    entry.jsonlDownloadUri,
    entry.download_url,
  ].find((value) => typeof value === 'string' && value.startsWith('http'));
  if (known) return known;

  const [, guessed] =
    Object.entries(entry).find(
      ([key, value]) =>
        /download/i.test(key) && typeof value === 'string' && value.startsWith('http'),
    ) ?? [];
  return guessed;
}

/**
 * Gibt den Inhalt einer Antwort als Datenstrom zurück und entpackt ihn, falls
 * nötig.
 *
 * Scryfall bietet die Sammeldatei inzwischen gepackt an. Kommt sie mit einer
 * Kopfzeile, die das ankündigt, entpackt `fetch` bereits selbst; wird sie als
 * Datei ausgeliefert, nicht. Deshalb entscheiden die ersten beiden Bytes:
 * 1f 8b kennzeichnet ein gepacktes Archiv.
 */
async function* unpacked(response) {
  const reader = response.body[Symbol.asyncIterator]();
  const first = await reader.next();
  if (first.done) return;

  const rest = async function* () {
    yield first.value;
    for (let next = await reader.next(); !next.done; next = await reader.next()) yield next.value;
  };

  const head = first.value;
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) {
    console.log('· Scryfall: Sammeldatei ist gepackt, wird beim Lesen entpackt');
    yield* Readable.from(rest()).pipe(createGunzip());
    return;
  }
  yield* rest();
}

/**
 * Liest einen JSON-Datenstrom Objekt für Objekt.
 *
 * Scryfall liefert die Sammeldatei mit einem Objekt je Zeile aus. Falls das
 * einmal nicht gilt, sammelt der Puffer so lange weiter, bis eine Zeile
 * gültiges JSON ergibt – das deckt auch mehrzeilig formatierte Dateien ab.
 */
async function* streamJsonArray(chunks) {
  const decoder = new TextDecoder();
  let buffer = '';
  let pending = '';

  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);

      const candidate = (pending + line).trim().replace(/^\[/, '').replace(/,$/, '');
      if (!candidate || candidate === ']') {
        pending = '';
        continue;
      }
      try {
        yield JSON.parse(candidate);
        pending = '';
      } catch {
        // Objekt geht über mehrere Zeilen – weitersammeln
        pending = `${pending}${line}\n`;
        if (pending.length > 5_000_000) pending = ''; // Notbremse gegen Endloswachstum
      }
    }
  }

  // Die letzte Zeile endet nicht zwingend mit einem Umbruch
  const last = (pending + buffer).trim().replace(/^\[/, '').replace(/[,\]]$/, '');
  if (last) {
    try {
      yield JSON.parse(last);
    } catch {
      // unvollständiger Rest – nichts zu holen
    }
  }
}

async function main() {
  let index;
  try {
    index = JSON.parse(await readFile(`${dir}/index.json`, 'utf8'));
  } catch {
    console.error(`Kein index.json in ${dir} – nichts zu ergänzen.`);
    exit(0);
  }

  const magic = index.files.find((entry) => entry.cardmarketGameId === 1);
  if (!magic) {
    console.log('· Keine Magic-Dateien vorhanden, Scryfall wird übersprungen.');
    exit(0);
  }

  console.log('· Scryfall: Sammeldatei suchen …');
  const catalog = await fetch(`${API}/bulk-data`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!catalog.ok) {
    const hint = (await catalog.text()).slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`bulk-data → HTTP ${catalog.status}: ${hint}`);
  }
  const bulk = await catalog.json();
  // Je nach Antwortform steht die Liste unter data oder direkt an der Wurzel
  const list = Array.isArray(bulk) ? bulk : (bulk.data ?? bulk.bulk_data ?? []);
  console.log(`· Scryfall: ${list.length} Sammeldateien angeboten: ${list.map((i) => i.type ?? i.name).join(', ')}`);

  // "default_cards" bevorzugt: eine Zeile je Ausgabe. Sonst die nächstbeste,
  // die alle Ausgaben enthält.
  const entry =
    list.find((item) => item.type === 'default_cards') ??
    list.find((item) => item.type === 'unique_artwork') ??
    list.find((item) => /default|unique/i.test(item.name ?? ''));
  if (!entry) {
    throw new Error(`Keine passende Sammeldatei gefunden. Angeboten: ${list.map((i) => i.type).join(', ')}`);
  }

  // Die Adresse der Datei steht je nach Fassung unter einem anderen Feld. Notfalls
  // führt der Verweis auf den Einzeleintrag zum Ziel.
  let download = addressOf(entry);
  if (!download && entry.uri) {
    console.log(`· Scryfall: Adresse fehlt im Listeneintrag (Felder: ${Object.keys(entry).join(', ')}), frage ${entry.uri} ab`);
    const detail = await fetch(entry.uri, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (detail.ok) download = addressOf(await detail.json());
  }
  if (!download) {
    throw new Error(`Keine Download-Adresse gefunden. Felder des Eintrags: ${Object.keys(entry).join(', ')}`);
  }
  const size = entry.size ?? entry.compressed_size ?? 0;
  console.log(`· Scryfall: ${entry.type ?? entry.name} → ${download} (${(size / 1e6).toFixed(0)} MB)`);

  const response = await fetch(download, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`Sammeldatei → HTTP ${response.status}`);

  const byProduct = new Map();
  let seen = 0;
  for await (const card of streamJsonArray(unpacked(response))) {
    seen++;
    const id = card?.cardmarket_id;
    if (!id) continue;
    // Englische Ausgabe bevorzugen; sonst die erste gefundene
    if (byProduct.has(id) && card.lang !== 'en') continue;
    byProduct.set(id, {
      set: String(card.set ?? '').toUpperCase(),
      setName: card.set_name,
      number: card.collector_number,
      rarity: card.rarity,
    });
  }

  const file = 'product-meta-magic.json';
  await writeFile(`${dir}/${file}`, JSON.stringify(Object.fromEntries(byProduct)), 'utf8');
  console.log(
    `✓ Scryfall: ${seen.toLocaleString('de-CH')} Ausgaben gelesen, ` +
      `${byProduct.size.toLocaleString('de-CH')} mit Cardmarket-Nummer → ${file}`,
  );

  index.files.push({ kind: 'productMeta', game: 'magic', cardmarketGameId: 1, file });
  await writeFile(`${dir}/index.json`, JSON.stringify(index, null, 2), 'utf8');
}

main().catch((err) => {
  // Fehlschlag darf den Deploy nicht aufhalten – dann fehlen nur die Sets
  console.error('Scryfall-Ergänzung fehlgeschlagen:', err.message);
  exit(0);
});
