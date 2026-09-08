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

async function scanPage(slug) {
  const url = `https://www.cardmarket.com/en/${slug}/Data/Price-Guide`;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!response.ok) {
      console.log(`  Seite ${url} → HTTP ${response.status}`);
      return;
    }
    const html = await response.text();
    // Alles einsammeln, was nach einer Datei oder einem Download aussieht
    const links = new Set();
    for (const match of html.matchAll(/(https?:\/\/[^"'\s<>]+\.(?:json|csv|zip|gz))/gi)) links.add(match[1]);
    for (const match of html.matchAll(/href="([^"]*(?:download|Download|export|Export)[^"]*)"/g)) links.add(match[1]);
    if (links.size === 0) {
      console.log(`  Seite ${url} gelesen (${(html.length / 1000).toFixed(0)} kB), keine Download-Links im HTML.`);
      console.log('  (Die Seite lädt ihre Links vermutlich per JavaScript nach.)');
    } else {
      console.log(`  Links auf ${url}:`);
      for (const link of links) console.log(`    ${link}`);
    }
  } catch (err) {
    console.log(`  Seite ${url} → Fehler: ${err.message}`);
  }
}

async function main() {
  const onlyCandidates = argv.includes('--candidates');
  for (const game of GAMES) {
    console.log(`\n=== ${game.name} (idGame ${game.id}) ===`);
    if (!onlyCandidates) await scanPage(game.slug);
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
