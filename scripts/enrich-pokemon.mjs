#!/usr/bin/env node
/**
 * Ergänzt Pokémon-Karten um Set-Code, Sammlernummer und Seltenheit.
 *
 * Anders als bei Magic gibt es keine freie Quelle, die die
 * Cardmarket-Produktnummer mitführt. Die Zuordnung läuft deshalb über die
 * Edition: der Cardmarket-Katalog gruppiert die Karten nach `idExpansion`, ohne
 * deren Namen zu kennen. Für jede dieser Gruppen wird geprüft, in welchem
 * bekannten Set die meisten ihrer Kartennamen vorkommen – stimmen genügend
 * überein, ist die Edition erkannt und die Karten bekommen Code und Nummer.
 *
 * Ein Abgleich rein über den Kartennamen wäre unbrauchbar: derselbe Name kommt
 * in vielen Sets vor. Über die Gruppe ist er eindeutig.
 *
 * Nutzung: node scripts/enrich-pokemon.mjs [ordner]   (Standard: dist/prices)
 *
 * Datenquelle: pokemontcg.io (frei, ohne Anmeldung nutzbar).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const dir = argv[2] ?? 'dist/prices';
const UA = 'TwoMoonsMarket/0.1 (+https://github.com/pabloesteves91/TwoMoonsMarket)';
const API = 'https://api.pokemontcg.io/v2';

/** Mindestanforderungen, damit eine Edition als erkannt gilt. */
export const MATCH_MIN_CARDS = 5;
export const MATCH_MIN_SHARE = 0.3;

/** Vereinheitlicht Kartennamen: Zusätze in Klammern und Sonderzeichen raus. */
export function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Ordnet jeder Cardmarket-Edition das am besten passende bekannte Set zu.
 *
 * @param groups     Map idExpansion -> Liste normalisierter Kartennamen
 * @param setsByName Map normalisierter Name -> Liste { setId, number, rarity }
 * @returns Map idExpansion -> { setId, score, share }
 */
export function matchExpansions(groups, setsByName) {
  const result = new Map();
  for (const [expansionId, names] of groups) {
    const votes = new Map();
    for (const name of names) {
      // Jede Karte stimmt für die Sets ab, in denen ihr Name vorkommt
      for (const entry of setsByName.get(name) ?? []) {
        votes.set(entry.setId, (votes.get(entry.setId) ?? 0) + 1);
      }
    }
    let best = null;
    for (const [setId, score] of votes) {
      if (!best || score > best.score) best = { setId, score };
    }
    if (!best) continue;
    const share = best.score / names.length;
    if (best.score >= MATCH_MIN_CARDS && share >= MATCH_MIN_SHARE) {
      result.set(expansionId, { ...best, share });
    }
  }
  return result;
}

async function getJson(url, attempt = 1) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (response.status === 429 && attempt <= 3) {
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    return getJson(url, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`${url} → HTTP ${response.status}: ${(await response.text()).slice(0, 150)}`);
  }
  return response.json();
}

async function loadKnownSets() {
  const sets = (await getJson(`${API}/sets?pageSize=250`)).data ?? [];
  console.log(`· pokemontcg.io: ${sets.length} Sets`);

  const setsById = new Map(sets.map((set) => [set.id, set]));
  const byName = new Map();
  let cards = 0;

  for (const set of sets) {
    let page = 1;
    for (;;) {
      const query = new URLSearchParams({
        q: `set.id:${set.id}`,
        pageSize: '250',
        page: String(page),
        select: 'id,name,number,rarity,set',
      });
      const body = await getJson(`${API}/cards?${query}`);
      const list = body.data ?? [];
      for (const card of list) {
        const key = normalizeName(card.name);
        const entry = { setId: set.id, number: card.number, rarity: card.rarity };
        const existing = byName.get(key);
        if (existing) existing.push(entry);
        else byName.set(key, [entry]);
        cards++;
      }
      if (list.length < 250) break;
      page++;
    }
  }
  console.log(`· pokemontcg.io: ${cards.toLocaleString('de-CH')} Karten geladen`);
  return { setsById, byName };
}

async function main() {
  let index;
  try {
    index = JSON.parse(await readFile(`${dir}/index.json`, 'utf8'));
  } catch {
    console.error(`Kein index.json in ${dir} – nichts zu ergänzen.`);
    exit(0);
  }

  const catalogFile = index.files.find((f) => f.cardmarketGameId === 6 && f.kind === 'catalog');
  if (!catalogFile) {
    console.log('· Kein Pokémon-Katalog vorhanden, übersprungen.');
    exit(0);
  }

  const catalog = JSON.parse(await readFile(`${dir}/${catalogFile.file}`, 'utf8'));
  const products = catalog.products ?? catalog.product ?? [];

  // Karten nach Cardmarket-Edition gruppieren
  const groups = new Map();
  const productsByExpansion = new Map();
  for (const product of products) {
    const expansionId = Number(product.idExpansion);
    const id = Number(product.idProduct);
    if (!expansionId || !id || !product.name) continue;
    const key = normalizeName(product.name);
    if (!groups.has(expansionId)) {
      groups.set(expansionId, []);
      productsByExpansion.set(expansionId, []);
    }
    groups.get(expansionId).push(key);
    productsByExpansion.get(expansionId).push({ id, key });
  }
  console.log(`· Cardmarket: ${products.length.toLocaleString('de-CH')} Produkte in ${groups.size} Editionen`);

  const { setsById, byName } = await loadKnownSets();
  const matched = matchExpansions(groups, byName);
  console.log(`· ${matched.size} von ${groups.size} Editionen zugeordnet`);

  const meta = {};
  for (const [expansionId, match] of matched) {
    const set = setsById.get(match.setId);
    // Der PTCGO-Code ist das Kürzel, das im Laden verwendet wird
    const code = (set?.ptcgoCode ?? set?.id ?? '').toUpperCase();
    for (const product of productsByExpansion.get(expansionId) ?? []) {
      const card = (byName.get(product.key) ?? []).find((entry) => entry.setId === match.setId);
      if (!card) continue;
      meta[product.id] = { set: code, setName: set?.name, number: card.number, rarity: card.rarity };
    }
  }

  const file = 'product-meta-pokemon.json';
  await writeFile(`${dir}/${file}`, JSON.stringify(meta), 'utf8');
  console.log(`✓ Pokémon: ${Object.keys(meta).length.toLocaleString('de-CH')} Karten mit Set und Nummer → ${file}`);

  index.files.push({ kind: 'productMeta', game: 'pokemon', cardmarketGameId: 6, file });
  await writeFile(`${dir}/index.json`, JSON.stringify(index, null, 2), 'utf8');
}

// Als Modul eingebunden (Test) nicht ausführen
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Pokémon-Ergänzung fehlgeschlagen:', err.message);
    exit(0);
  });
}
