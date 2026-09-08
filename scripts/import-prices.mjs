#!/usr/bin/env node
/**
 * Lädt die Cardmarket-Preislisten herunter und legt sie unter ./data ab.
 * Die erzeugten Dateien werden anschliessend in der App unter "Preise" hochgeladen
 * (oder direkt von einem eigenen Backend weiterverarbeitet).
 *
 * Nutzung:
 *   node scripts/import-prices.mjs                  # Magic + Pokémon
 *   node scripts/import-prices.mjs --games 1,6,3    # eigene Cardmarket-Spiel-IDs
 *   node scripts/import-prices.mjs --out ./data     # Zielordner
 *   node scripts/import-prices.mjs --catalog        # zusätzlich Produktnamen laden
 *   node scripts/import-prices.mjs --index          # index.json für den Abruf aus der App
 *
 * Mit --index entstehen Dateien mit festen Namen (price-guide-magic.json) plus
 * ein index.json. Wird dieser Ordner mitveröffentlicht, kann die App die Preise
 * direkt aus dem Web laden – ohne Datei-Upload und ohne Rechner.
 *
 * Hinweis: Cardmarket bietet keine offene API. Das Skript versucht die öffentlich
 * ausgelieferten Preislisten-Dateien; ändert Cardmarket die Struktur oder verlangt
 * eine Anmeldung, bricht das Skript mit einer klaren Meldung ab. In dem Fall die
 * Preisliste manuell herunterladen und in der App hochladen.
 * Prüft bitte vorab die Nutzungsbedingungen von Cardmarket für automatisierte Abrufe.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const GAME_NAMES = { 1: 'magic', 3: 'yugioh', 6: 'pokemon' };

const PRICE_GUIDE_URLS = (gameId) => [
  `https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_${gameId}.json`,
  `https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_${gameId}.csv`,
];

const CATALOG_URLS = (gameId) => [
  `https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_${gameId}.json`,
  `https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_${gameId}.csv`,
];

// Der Produktkatalog führt die Edition möglicherweise nur als Nummer. Die
// Zuordnung Nummer -> Name steht in einer eigenen Datei; welcher Pfad stimmt,
// ist nicht dokumentiert, deshalb der Reihe nach.
const EXPANSION_URLS = (gameId) => [
  `https://downloads.s3.cardmarket.com/productCatalog/expansion/expansions_${gameId}.json`,
  `https://downloads.s3.cardmarket.com/productCatalog/expansions/expansions_${gameId}.json`,
  `https://downloads.s3.cardmarket.com/productCatalog/expansion/expansion_${gameId}.json`,
  `https://downloads.s3.cardmarket.com/productCatalog/expansionList/expansions_${gameId}.json`,
];

function parseArgs() {
  const args = { games: [1, 6], out: './data', catalog: false, index: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--games') args.games = argv[++i].split(',').map((v) => Number(v.trim()));
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--catalog') args.catalog = true;
    else if (arg === '--index') args.index = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Optionen: --games 1,6  --out ./data  --catalog  --index');
      exit(0);
    }
  }
  return args;
}

async function tryDownload(urls) {
  const errors = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          // Ohne User-Agent antwortet der CDN teilweise mit 403
          'User-Agent': 'TwoMoonsMarket/0.1 (+internes Preis-Tooling)',
          Accept: 'application/json, text/csv;q=0.9, */*;q=0.8',
        },
        redirect: 'follow',
      });
      if (!response.ok) {
        errors.push(`${url} → HTTP ${response.status}`);
        continue;
      }
      const body = await response.text();
      if (body.trim().startsWith('<')) {
        errors.push(`${url} → HTML statt Daten (vermutlich Login-/Blockseite)`);
        continue;
      }
      return { url, body };
    } catch (err) {
      errors.push(`${url} → ${err.message}`);
    }
  }
  throw new Error(`Kein Download erfolgreich:\n  ${errors.join('\n  ')}`);
}

async function main() {
  const { games, out, catalog, index } = parseArgs();
  await mkdir(out, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const manifest = { createdAt: new Date().toISOString(), files: [] };
  let failures = 0;

  // Mit --index feste Dateinamen, damit die App immer dieselbe URL abrufen kann
  const name = (kind, label, ext) => (index ? `${kind}-${label}.${ext}` : `${kind}-${label}-${stamp}.${ext}`);

  for (const gameId of games) {
    const label = GAME_NAMES[gameId] ?? `game-${gameId}`;

    try {
      const { url, body } = await tryDownload(PRICE_GUIDE_URLS(gameId));
      const ext = url.endsWith('.csv') ? 'csv' : 'json';
      const file = name('price-guide', label, ext);
      await writeFile(`${out}/${file}`, body, 'utf8');
      manifest.files.push({ kind: 'priceGuide', game: label, cardmarketGameId: gameId, file, bytes: body.length });
      console.log(`✓ Preisliste ${label}: ${out}/${file} (${(body.length / 1e6).toFixed(1)} MB, Quelle ${url})`);
    } catch (err) {
      failures++;
      console.error(`✗ Preisliste ${label} fehlgeschlagen.\n${err.message}`);
    }

    if (!catalog) continue;
    try {
      const { url, body } = await tryDownload(CATALOG_URLS(gameId));
      const ext = url.endsWith('.csv') ? 'csv' : 'json';
      const file = name('products', label, ext);
      await writeFile(`${out}/${file}`, body, 'utf8');
      manifest.files.push({ kind: 'catalog', game: label, cardmarketGameId: gameId, file, bytes: body.length });
      console.log(`✓ Produktkatalog ${label}: ${out}/${file} (Quelle ${url})`);
    } catch (err) {
      failures++;
      console.error(`✗ Produktkatalog ${label} fehlgeschlagen.\n${err.message}`);
    }

    // Editionsnamen sind optional – fehlen sie, bleibt das Set leer, alles
    // andere funktioniert weiter.
    try {
      const { url, body } = await tryDownload(EXPANSION_URLS(gameId));
      const file = name('expansions', label, 'json');
      await writeFile(`${out}/${file}`, body, 'utf8');
      manifest.files.push({ kind: 'expansions', game: label, cardmarketGameId: gameId, file, bytes: body.length });
      console.log(`✓ Editionen ${label}: ${out}/${file} (Quelle ${url})`);
    } catch (err) {
      console.warn(`· Editionsliste ${label} nicht gefunden – Sets bleiben leer.\n${err.message}`);
    }
  }

  if (index) {
    if (manifest.files.length === 0) {
      console.error('\nKein einziger Download hat geklappt – index.json wird nicht geschrieben.');
      exit(1);
    }
    // Kataloge zuerst: sie liefern die Kartennamen, die Preisliste ergänzt danach die Preise
    manifest.files.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'catalog' ? -1 : 1));
    await writeFile(`${out}/index.json`, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`✓ Manifest: ${out}/index.json (${manifest.files.length} Dateien)`);
  }

  if (failures > 0) {
    console.error(
      `\n${failures} Download(s) fehlgeschlagen. Falls Cardmarket den direkten Abruf sperrt:\n` +
        '  1. https://www.cardmarket.com/en/Magic/Data/Price-Guide im Browser öffnen\n' +
        '  2. Preisliste herunterladen\n' +
        '  3. Datei in der App unter "Preise" hochladen\n',
    );
    // Mit --index zählt ein Teilerfolg als Erfolg: die geladenen Dateien sollen
    // veröffentlicht werden, statt dass der Deploy sie wegen einer fehlenden verwirft.
    if (!index || manifest.files.length === 0) exit(1);
  }
  console.log(`\nFertig. ${manifest.files.length || 'Alle'} Datei(en) liegen in ${out}.`);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
