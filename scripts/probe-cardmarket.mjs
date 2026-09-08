#!/usr/bin/env node
/**
 * Sucht die Datei mit den Editionsnamen.
 *
 * Der Produktkatalog von Cardmarket führt die Edition nur als `idExpansion`.
 * Wo die Zuordnung Nummer -> Name liegt, ist nicht dokumentiert – geraten haben
 * wir schon, ohne Treffer. Dieses Skript geht deshalb zwei Wege:
 *
 *  1. Es liest die Price-Guide-Seite und sammelt alle Links, die nach
 *     Downloads aussehen. Damit steht im Protokoll, was Cardmarket dort
 *     tatsächlich anbietet.
 *  2. Es prüft eine Liste möglicher Pfade und meldet je Pfad den HTTP-Status.
 *
 * Das Ergebnis steht im Actions-Protokoll; das Skript schlägt nie fehl und
 * blockiert damit keinen Deploy.
 */

import { argv } from 'node:process';

const GAMES = [
  { id: 1, name: 'magic', slug: 'Magic' },
  { id: 6, name: 'pokemon', slug: 'Pokemon' },
];

const UA = 'TwoMoonsMarket/0.1 (+internes Preis-Tooling)';

async function head(url) {
  try {
    const response = await fetch(url, { method: 'GET', headers: { 'User-Agent': UA }, redirect: 'follow' });
    const type = response.headers.get('content-type') ?? '';
    const length = response.headers.get('content-length');
    return `${response.status} ${type.split(';')[0]}${length ? ` ${(Number(length) / 1e6).toFixed(1)} MB` : ''}`;
  } catch (err) {
    return `Fehler: ${err.message}`;
  }
}

function candidates(gameId) {
  const base = 'https://downloads.s3.cardmarket.com/productCatalog';
  return [
    `${base}/expansion/expansions_${gameId}.json`,
    `${base}/expansions/expansions_${gameId}.json`,
    `${base}/expansion/expansion_${gameId}.json`,
    `${base}/expansionList/expansions_${gameId}.json`,
    `${base}/expansions_${gameId}.json`,
    `${base}/expansion/expansions_singles_${gameId}.json`,
    `${base}/productList/expansions_${gameId}.json`,
    `${base}/expansionList/expansion_${gameId}.json`,
    `${base}/expansion/expansions_${gameId}.csv`,
    `${base}/expansions/expansions_${gameId}.csv`,
  ];
}

async function scanPage(url) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!response.ok) {
      console.log(`  ${url} → HTTP ${response.status}`);
      return;
    }
    const html = await response.text();
    console.log(`  ${url} → ${(html.length / 1000).toFixed(0)} kB`);

    // 1. Dateien, die zum Herunterladen angeboten werden
    const links = new Set();
    for (const match of html.matchAll(/(https?:\/\/[^"'\s<>]+\.(?:json|csv|zip|gz))/gi)) links.add(match[1]);
    for (const match of html.matchAll(/href="([^"]*(?:download|Download|export|Export)[^"]*)"/g)) links.add(match[1]);
    for (const link of [...links].slice(0, 20)) console.log(`    Datei: ${link}`);

    // 2. Auswahlfelder: dort steht die Editionsnummer oft direkt neben dem Namen
    const options = [...html.matchAll(/<option[^>]*value="(\d{2,7})"[^>]*>([^<]{2,80})<\/option>/g)];
    if (options.length > 0) {
      console.log(`    ${options.length} Auswahleinträge gefunden, die ersten fünf:`);
      for (const [, value, label] of options.slice(0, 5)) {
        console.log(`      ${value} = ${label.trim().replace(/&amp;/g, '&')}`);
      }
    }

    // 3. Editionsnummern in eingebettetem JavaScript
    const embedded = [...html.matchAll(/"idExpansion"\s*:\s*(\d+)[^}]{0,120}?"(?:enName|name|expansionName)"\s*:\s*"([^"]{2,80})"/g)];
    if (embedded.length > 0) {
      console.log(`    ${embedded.length} Editionen in eingebettetem JavaScript, die ersten drei:`);
      for (const [, id, label] of embedded.slice(0, 3)) console.log(`      ${id} = ${label}`);
    }

    if (links.size === 0 && options.length === 0 && embedded.length === 0) {
      console.log('    Nichts Verwertbares im HTML (Inhalt wird vermutlich per JavaScript nachgeladen).');
    }
  } catch (err) {
    console.log(`  ${url} → Fehler: ${err.message}`);
  }
}

async function main() {
  const onlyCandidates = argv.includes('--candidates');
  for (const game of GAMES) {
    console.log(`\n=== ${game.name} (idGame ${game.id}) ===`);
    if (!onlyCandidates) {
      // Die Preisübersicht und die Produktsuche führen beide eine Editionsauswahl
      await scanPage(`https://www.cardmarket.com/en/${game.slug}/Data/Price-Guide`);
      await scanPage(`https://www.cardmarket.com/en/${game.slug}/Products/Singles`);
    }
    console.log('  Mögliche Pfade für die Editionsliste:');
    for (const url of candidates(game.id)) {
      console.log(`    ${await head(url)}  ${url}`);
    }
  }
  console.log('\nFertig. Ein Pfad mit Status 200 und JSON ist die gesuchte Datei.');
}

main().catch((err) => {
  console.error('Suche fehlgeschlagen:', err.message);
});
