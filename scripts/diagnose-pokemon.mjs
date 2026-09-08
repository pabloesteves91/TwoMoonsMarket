#!/usr/bin/env node
/**
 * Diagnose: warum bekommen so wenige Pokémon-Karten ein Set?
 *
 * Läuft nur auf Knopfdruck im CI, weil der Cardmarket-Katalog von aussen nicht
 * erreichbar ist. Der Lauf verändert nichts, er schreibt nur ins Protokoll.
 */
import { normalizeName, matchExpansions, attacksOf, variantOf, choosePrinting } from './enrich-pokemon.mjs';

const UA = 'TwoMoonsMarket/0.1 (+https://github.com/pabloesteves91/TwoMoonsMarket)';
const DATA = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master';

const get = async (url) => {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.json();
};

const catalog = await get('https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json');
const products = catalog.products ?? catalog.product ?? [];
console.log(`Cardmarket: ${products.length} Produkte`);
console.log('Beispielnamen:', products.slice(0, 25).map((p) => p.name).join(' | '));

const groups = new Map();
for (const product of products) {
  const id = Number(product.idExpansion);
  if (!id || !product.name) continue;
  if (!groups.has(id)) groups.set(id, []);
  groups.get(id).push(product.name);
}

const sets = await get(`${DATA}/sets/en.json`);
const byName = new Map();
const cardsPerSet = new Map();
await Promise.all(
  sets.map(async (set) => {
    const list = await get(`${DATA}/cards/en/${set.id}.json`).catch(() => []);
    cardsPerSet.set(set.id, list.length);
    for (const card of list) {
      const key = normalizeName(card.name);
      const entry = { setId: set.id, number: card.number, rarity: card.rarity };
      if (byName.has(key)) byName.get(key).push(entry);
      else byName.set(key, [entry]);
    }
  }),
);
console.log(`Bekannte Sets: ${sets.length}, Karten: ${[...cardsPerSet.values()].reduce((a, b) => a + b, 0)}`);

const normalized = new Map([...groups].map(([id, names]) => [id, names.map(normalizeName)]));
const matched = matchExpansions(normalized, byName);
console.log(`Zugeordnet: ${matched.size} von ${groups.size}`);

// Die grössten Editionen zuerst: dort liegt die Masse der Karten
const largest = [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, 15);
console.log('\n=== Die 15 grössten Cardmarket-Editionen ===');
for (const [id, names] of largest) {
  const hit = matched.get(id);
  const votes = new Map();
  for (const key of names.map(normalizeName)) {
    for (const entry of byName.get(key) ?? []) votes.set(entry.setId, (votes.get(entry.setId) ?? 0) + 1);
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0];
  const treffer = hit
    ? `→ ${hit.setId} (${(hit.share * 100).toFixed(0)} %)`
    : `KEIN TREFFER (bester: ${best ? `${best[0]} ${best[1]}/${names.length}` : 'keiner'})`;
  console.log(`${id}: ${names.length} Produkte ${treffer}`);
  console.log(`   Namen: ${names.slice(0, 6).join(' | ')}`);
}

// Innerhalb zugeordneter Editionen: wie viele Produkte finden ihre Karte?
let inMatched = 0;
let resolved = 0;
const misses = [];
const proben = [];
for (const [id, match] of matched) {
  for (const name of groups.get(id) ?? []) {
    inMatched++;
    const printings = (byName.get(normalizeName(name)) ?? []).filter((e) => e.setId === match.setId);
    if (printings.length > 0) {
      resolved++;
      if (proben.length < 12) {
        const card = choosePrinting(
          printings.slice().sort((a, b) => (parseInt(a.number, 10) || 1e9) - (parseInt(b.number, 10) || 1e9)),
          { attacks: attacksOf(name), variant: variantOf(name) },
        );
        proben.push(`${name} → ${match.setId} Nr. ${card.number}`);
      }
    } else if (misses.length < 12) misses.push(`${name} [${match.setId}]`);
  }
}
console.log(`\nIn zugeordneten Editionen: ${inMatched} Produkte, davon ${resolved} mit Karte (${((resolved / inMatched) * 100).toFixed(0)} %)`);
console.log(`Gesamt: ${resolved} von ${products.length} Cardmarket-Produkten bekämen Set und Nummer`);

// Knappe Treffer sind die gefährlichen: ein falsches Set wäre schlimmer als keines
const knapp = [...matched].filter(([, m]) => m.share < 0.65).length;
console.log(`Zuordnungen unter 65 % Anteil (heikel): ${knapp} von ${matched.size}`);

console.log('\nStichprobe:\n  ' + proben.join('\n  '));
console.log('\nNicht gefunden, Beispiele:\n  ' + misses.join('\n  '));
