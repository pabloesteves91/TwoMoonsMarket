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
import { argv, exit } from 'node:process';

const dir = argv[2] ?? 'dist/prices';
// Nur ASCII: ein Umlaut im User-Agent führt zu einer abgewiesenen Anfrage
const UA = 'TwoMoonsMarket/0.1 (+https://github.com/pabloesteves91/TwoMoonsMarket)';

/**
 * Liest einen JSON-Array-Datenstrom Objekt für Objekt.
 *
 * Scryfall liefert die Sammeldatei mit einem Objekt je Zeile aus. Falls das
 * einmal nicht gilt, sammelt der Puffer so lange weiter, bis eine Zeile
 * gültiges JSON ergibt – das deckt auch mehrzeilig formatierte Dateien ab.
 */
async function* streamJsonArray(response) {
  const decoder = new TextDecoder();
  let buffer = '';
  let pending = '';

  for await (const chunk of response.body) {
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
  const catalog = await fetch('https://api.scryfall.com/bulk-data', {
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
  if (!entry?.download_uri) {
    throw new Error(
      `Keine passende Sammeldatei gefunden. Antwortfelder: ${Object.keys(bulk).join(', ')}`,
    );
  }
  console.log(`· Scryfall: ${entry.type ?? entry.name} → ${entry.download_uri} (${((entry.size ?? 0) / 1e6).toFixed(0)} MB)`);

  const response = await fetch(entry.download_uri, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`Sammeldatei → HTTP ${response.status}`);

  const byProduct = new Map();
  let seen = 0;
  for await (const card of streamJsonArray(response)) {
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
