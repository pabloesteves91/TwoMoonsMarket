#!/usr/bin/env node
/**
 * Verdichtet die rohen Cardmarket-Downloads zu einer schlanken Datei je Spiel.
 *
 * Die Rohdateien sind zusammen leicht über 100 MB: der Produktkatalog enthält
 * viele Felder, die die App nie braucht, und Katalog und Preisliste sind zwei
 * getrennte Dateien, die über `idProduct` zusammengehören. Dieses Skript
 * verbindet beide und behält nur Name, Set und die Preisspalten – das Ergebnis
 * ist ein Bruchteil der Grösse und wird von Firebase Hosting zusätzlich
 * komprimiert ausgeliefert.
 *
 * Das Ausgabeformat entspricht dem Cardmarket-Price-Guide-JSON, die App braucht
 * also keinen eigenen Parser dafür.
 *
 * Nutzung: node scripts/build-price-bundle.mjs [ordner]   (Standard: dist/prices)
 */

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const dir = argv[2] ?? 'dist/prices';

/** Felder, die die App auswertet – alles andere fliegt raus. */
const PRICE_FIELDS = [
  ['avg', ['avg', 'avgSellPrice', 'avg-sell-price']],
  ['low', ['low', 'lowPrice', 'low-price']],
  ['lowEx', ['lowEx', 'lowPriceEx', 'low-price-ex+', 'lowExPlus']],
  ['trend', ['trend', 'trendPrice', 'trend-price']],
  ['germanProLow', ['germanProLow', 'german-pro-low']],
  ['suggested', ['suggested', 'suggestedPrice', 'suggested-price']],
  ['avg1', ['avg1', 'avg1day']],
  ['avg7', ['avg7', 'avg7days']],
  ['avg30', ['avg30', 'avg30days']],
  ['foilSell', ['foilSell', 'foil-sell']],
  ['foilLow', ['foilLow', 'foil-low']],
  ['foilTrend', ['foilTrend', 'foil-trend']],
  ['foilAvg1', ['foilAvg1', 'foil-avg1']],
  ['foilAvg7', ['foilAvg7', 'foil-avg7']],
  ['foilAvg30', ['foilAvg30', 'foil-avg30']],
];

const NAME_KEYS = ['name', 'enName', 'productName', 'engName'];
const SET_KEYS = ['expansionName', 'expansion', 'setName', 'set', 'expansionCode', 'abbreviation'];
const NUMBER_KEYS = ['number', 'collectorNumber', 'cardNumber', 'nr'];
const RARITY_KEYS = ['rarity', 'rarityName'];

function pick(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function listOf(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['priceGuides', 'products', 'expansion', 'expansions', 'prices', 'data', 'items', 'entries']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

async function readJson(file) {
  return JSON.parse(await readFile(`${dir}/${file}`, 'utf8'));
}

async function main() {
  let index;
  try {
    index = await readJson('index.json');
  } catch {
    console.error(`Kein index.json in ${dir} – nichts zu verdichten.`);
    exit(0);
  }

  const games = new Map();
  for (const entry of index.files) {
    const group = games.get(entry.game) ?? {
      game: entry.game,
      cardmarketGameId: entry.cardmarketGameId,
      files: [],
    };
    group.files.push(entry);
    games.set(entry.game, group);
  }

  const outFiles = [];
  const leftovers = [];

  for (const [game, group] of games) {
    // CSV-Downloads werden unverändert durchgereicht – der Parser der App kann sie
    const csv = group.files.filter((f) => f.file.endsWith('.csv'));
    if (csv.length) {
      leftovers.push(...csv);
      console.log(`· ${game}: ${csv.length} CSV-Datei(en) unverändert übernommen`);
    }

    const catalogFile = group.files.find((f) => f.kind === 'catalog' && f.file.endsWith('.json'));
    const priceFile = group.files.find((f) => f.kind === 'priceGuide' && f.file.endsWith('.json'));
    const expansionFile = group.files.find((f) => f.kind === 'expansions' && f.file.endsWith('.json'));
    if (!priceFile) continue;

    // Editionsnummer -> Name, falls die Editionsliste geladen werden konnte
    const expansions = new Map();
    if (expansionFile) {
      for (const row of listOf(await readJson(expansionFile.file))) {
        const id = Number(row.idExpansion ?? row.id);
        const label = pick(row, ['enName', 'name', 'expansionName', 'localization']);
        if (id && label) expansions.set(id, label);
      }
      console.log(`· ${game}: ${expansions.size.toLocaleString('de-CH')} Editionen`);
    }

    const names = new Map();
    if (catalogFile) {
      const rows = listOf(await readJson(catalogFile.file));
      // Diagnose: verrät im Protokoll, welche Felder Cardmarket tatsächlich
      // liefert – ohne das lässt sich fehlender Set-Name nur raten.
      if (rows[0]) console.log(`· ${game}: Katalogfelder = ${Object.keys(rows[0]).join(', ')}`);

      for (const row of rows) {
        const id = Number(row.idProduct ?? row.id);
        if (!id) continue;
        const expansionId = Number(row.idExpansion ?? row.expansionId);
        names.set(id, {
          name: pick(row, NAME_KEYS),
          set: pick(row, SET_KEYS) ?? (expansionId ? expansions.get(expansionId) : undefined),
          number: pick(row, NUMBER_KEYS),
          rarity: pick(row, RARITY_KEYS),
        });
      }
      const withSet = [...names.values()].filter((entry) => entry.set).length;
      console.log(
        `· ${game}: ${names.size.toLocaleString('de-CH')} Kartennamen aus dem Katalog, ` +
          `davon ${withSet.toLocaleString('de-CH')} mit Set`,
      );
    }

    const rows = [];
    for (const row of listOf(await readJson(priceFile.file))) {
      const id = Number(row.idProduct ?? row.id);
      if (!id) continue;

      const out = { idProduct: id };
      const meta = names.get(id);
      if (meta?.name) out.name = meta.name;
      if (meta?.set) out.expansion = meta.set;
      if (meta?.number) out.number = meta.number;
      if (meta?.rarity) out.rarity = meta.rarity;

      let hasPrice = false;
      for (const [target, keys] of PRICE_FIELDS) {
        for (const key of keys) {
          const value = row[key];
          if (typeof value === 'number' && value > 0) {
            out[target] = Math.round(value * 100) / 100;
            hasPrice = true;
            break;
          }
        }
      }
      if (hasPrice) rows.push(out);
    }

    const file = `prices-${game}.json`;
    const body = JSON.stringify({ createdAt: index.createdAt, priceGuides: rows });
    await writeFile(`${dir}/${file}`, body, 'utf8');
    outFiles.push({
      kind: 'priceGuide',
      game,
      cardmarketGameId: group.cardmarketGameId,
      file,
      bytes: body.length,
      entries: rows.length,
      named: rows.filter((r) => r.name).length,
    });
    console.log(
      `✓ ${game}: ${rows.length.toLocaleString('de-CH')} Karten → ${file} ` +
        `(${(body.length / 1e6).toFixed(1)} MB, ${rows.filter((r) => r.name).length.toLocaleString('de-CH')} mit Namen, ` +
        `${rows.filter((r) => r.expansion).length.toLocaleString('de-CH')} mit Set)`,
    );

    // Rohdateien entfernen, damit sie nicht mitveröffentlicht werden
    for (const entry of group.files) {
      if (!entry.file.endsWith('.json')) continue;
      await unlink(`${dir}/${entry.file}`).catch(() => {});
    }
  }

  if (outFiles.length === 0 && leftovers.length === 0) {
    console.error('Keine verwertbaren Dateien gefunden.');
    exit(1);
  }

  await writeFile(
    `${dir}/index.json`,
    JSON.stringify({ createdAt: index.createdAt, files: [...outFiles, ...leftovers] }, null, 2),
    'utf8',
  );
  console.log(`✓ index.json aktualisiert (${outFiles.length + leftovers.length} Dateien)`);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
