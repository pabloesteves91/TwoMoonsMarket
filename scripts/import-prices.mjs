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

function parseArgs() {
  const args = { games: [1, 6], out: './data', catalog: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--games') args.games = argv[++i].split(',').map((v) => Number(v.trim()));
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--catalog') args.catalog = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Optionen: --games 1,6  --out ./data  --catalog');
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
  const { games, out, catalog } = parseArgs();
  await mkdir(out, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  let failures = 0;

  for (const gameId of games) {
    const label = GAME_NAMES[gameId] ?? `game-${gameId}`;

    try {
      const { url, body } = await tryDownload(PRICE_GUIDE_URLS(gameId));
      const ext = url.endsWith('.csv') ? 'csv' : 'json';
      const target = `${out}/price-guide-${label}-${stamp}.${ext}`;
      await writeFile(target, body, 'utf8');
      console.log(`✓ Preisliste ${label}: ${target} (${(body.length / 1e6).toFixed(1)} MB, Quelle ${url})`);
    } catch (err) {
      failures++;
      console.error(`✗ Preisliste ${label} fehlgeschlagen.\n${err.message}`);
    }

    if (!catalog) continue;
    try {
      const { url, body } = await tryDownload(CATALOG_URLS(gameId));
      const ext = url.endsWith('.csv') ? 'csv' : 'json';
      const target = `${out}/products-${label}-${stamp}.${ext}`;
      await writeFile(target, body, 'utf8');
      console.log(`✓ Produktkatalog ${label}: ${target} (Quelle ${url})`);
    } catch (err) {
      failures++;
      console.error(`✗ Produktkatalog ${label} fehlgeschlagen.\n${err.message}`);
    }
  }

  if (failures > 0) {
    console.error(
      '\nMindestens ein Download ist fehlgeschlagen. Falls Cardmarket den direkten Abruf sperrt:\n' +
        '  1. https://www.cardmarket.com/en/Magic/Data/Price-Guide im Browser öffnen\n' +
        '  2. Preisliste herunterladen\n' +
        '  3. Datei in der App unter "Preise" hochladen\n',
    );
    exit(1);
  }
  console.log(`\nFertig. Dateien liegen in ${out} und können in der App unter "Preise" hochgeladen werden.`);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
