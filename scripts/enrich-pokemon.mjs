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
 * Datenquelle: pokemontcg.io (frei, ohne Anmeldung nutzbar). Die Daten werden
 * bevorzugt aus dem offenen Datenbestand des Projekts geladen: die API selbst
 * antwortet immer wieder mit 500 oder 502, und ein Lauf braucht Hunderte
 * Anfragen. Der Datenbestand liegt als feste Dateien auf einem Auslieferungsnetz
 * und ist damit ungleich verlässlicher. Antwortet er nicht, wird die API als
 * Rückfalllösung versucht.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const dir = argv[2] ?? 'dist/prices';
const UA = 'TwoMoonsMarket/0.1 (+https://github.com/pabloesteves91/TwoMoonsMarket)';
const API = 'https://api.pokemontcg.io/v2';
const DATA = process.env.POKEMON_DATA_BASE ?? 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master';

/**
 * Zeitgrenze für das Laden der Sets. Die Quelle antwortet zeitweise mit 500 oder
 * 502; mit Wiederholungen kann das Laden aller Sets sonst beliebig lange dauern.
 * Nach Ablauf wird mit den bis dahin geladenen Sets weitergearbeitet.
 */
const TIME_BUDGET_MS = Number(process.env.POKEMON_TIME_BUDGET_MS ?? 4 * 60 * 1000);

/**
 * Mindestanforderungen, damit eine Edition als erkannt gilt.
 *
 * Da jedes Produkt nur eine Stimme je Set hat, ist der Anteil unmittelbar
 * lesbar: die Hälfte der Produkte muss im selben Set liegen. Ein falsches Set
 * wäre schlimmer als gar keines – im Laden wird danach ausgepreist.
 */
export const MATCH_MIN_CARDS = 5;
export const MATCH_MIN_SHARE = 0.5;

/**
 * Vereinheitlicht Kartennamen: Zusätze in Klammern und Sonderzeichen raus.
 *
 * Cardmarket hängt bei Pokémon die Attacken in eckigen Klammern an –
 * "Ninetales [Lure | Fire Blast]". Ohne sie zu entfernen findet kein einziger
 * dieser Namen seine Karte.
 */
export function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Liest die Attacken aus einem Cardmarket-Namen.
 *
 * Genau daran lässt sich der richtige Druck erkennen: kommt ein Pokémon
 * mehrfach in derselben Edition vor, unterscheiden sich die Attacken.
 */
export function attacksOf(name) {
  const match = /\[([^\]]*)\]/.exec(String(name));
  if (!match) return [];
  return match[1]
    .split('|')
    .map((part) => normalizeName(part))
    .filter(Boolean);
}

/**
 * Liest die Variantennummer aus einem Cardmarket-Namen.
 *
 * Kommt eine Karte mehrfach in derselben Edition vor – etwa als gewöhnlicher
 * Druck und als Vollbild –, hängt Cardmarket "(V1)", "(V2)" an. Ohne diese
 * Unterscheidung bekämen alle Drucke dieselbe Sammlernummer.
 */
export function variantOf(name) {
  const match = /\(\s*v\s*(\d+)\s*\)/i.exec(String(name));
  return match ? Number(match[1]) : 1;
}

/** Sammlernummern sortieren sich nach Zahl, nicht nach Text: 2 vor 192. */
function numeric(value) {
  const digits = /\d+/.exec(String(value ?? ''));
  return digits ? Number(digits[0]) : Number.MAX_SAFE_INTEGER;
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
      // Jedes Produkt hat je Set genau eine Stimme. Zählte jeder Druck einzeln,
      // käme eine Edition auf über 100 % – und Editionen aus lauter
      // Energiekarten gewännen gegen die Edition, um die es wirklich geht.
      const sets = new Set((setsByName.get(name) ?? []).map((entry) => entry.setId));
      for (const setId of sets) votes.set(setId, (votes.get(setId) ?? 0) + 1);
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

/**
 * Holt JSON und wiederholt bei Überlastung. Neben 429 (zu viele Anfragen)
 * werden auch 5xx wiederholt: die API antwortet zeitweise mit 502.
 */
async function getJson(url, attempt = 1, maxAttempts = 3) {
  let response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  } catch (err) {
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      return getJson(url, attempt + 1, maxAttempts);
    }
    throw err;
  }

  if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    return getJson(url, attempt + 1, maxAttempts);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 120).replace(/\s+/g, ' ')}`);
  }
  return response.json();
}

/**
 * Lädt Sets und Karten aus dem festen Datenbestand.
 *
 * Eine Datei je Set, dafür ohne Seitenaufteilung – und von einem
 * Auslieferungsnetz statt aus der Anwendung. Mehrere Abrufe laufen nebeneinander,
 * damit der Gesamtlauf kurz bleibt.
 */
async function loadFromDataFiles() {
  const sets = await getJson(`${DATA}/sets/en.json`);
  if (!Array.isArray(sets) || sets.length === 0) throw new Error('Set-Liste leer');
  console.log(`· Pokémon-Datenbestand: ${sets.length} Sets`);

  const setsById = new Map(sets.map((set) => [set.id, set]));
  const byName = new Map();
  const failed = [];
  let cards = 0;

  const queue = [...sets];
  const deadline = Date.now() + TIME_BUDGET_MS;
  const worker = async () => {
    for (let set = queue.shift(); set; set = queue.shift()) {
      if (Date.now() > deadline) return;
      try {
        const list = await getJson(`${DATA}/cards/en/${set.id}.json`);
        for (const card of list ?? []) {
          const key = normalizeName(card.name);
          const entry = {
            setId: set.id,
            number: card.number,
            rarity: card.rarity,
            attacks: (card.attacks ?? []).map((attack) => normalizeName(attack.name)),
          };
          const existing = byName.get(key);
          if (existing) existing.push(entry);
          else byName.set(key, [entry]);
          cards++;
        }
      } catch (err) {
        failed.push(`${set.id} (${err.message})`);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  console.log(`· Pokémon-Datenbestand: ${cards.toLocaleString('de-CH')} Karten geladen`);
  if (failed.length) {
    console.warn(`· ${failed.length} Sets nicht abrufbar, die ersten drei: ${failed.slice(0, 3).join(' | ')}`);
  }
  if (cards === 0) throw new Error('Kein einziges Set abrufbar');
  return { setsById, byName };
}

/** Rückfalllösung: dieselben Daten über die API, Set für Set und Seite für Seite. */
async function loadFromApi() {
  const sets = (await getJson(`${API}/sets?pageSize=250`)).data ?? [];
  console.log(`· pokemontcg.io: ${sets.length} Sets`);

  const setsById = new Map(sets.map((set) => [set.id, set]));
  const byName = new Map();
  let cards = 0;

  // Ein einzelnes Set, das nicht antwortet, darf nicht den ganzen Lauf kippen –
  // die übrigen Editionen lassen sich trotzdem zuordnen.
  const failed = [];
  const deadline = Date.now() + TIME_BUDGET_MS;
  let stoppedEarly = false;

  for (const set of sets) {
    if (Date.now() > deadline) {
      stoppedEarly = true;
      break;
    }
    try {
      let page = 1;
      for (;;) {
        const query = new URLSearchParams({
          q: `set.id:${set.id}`,
          pageSize: '250',
          page: String(page),
        });
        const body = await getJson(`${API}/cards?${query}`);
        const list = body.data ?? [];
        for (const card of list) {
          const key = normalizeName(card.name);
          const entry = {
            setId: set.id,
            number: card.number,
            rarity: card.rarity,
            attacks: (card.attacks ?? []).map((attack) => normalizeName(attack.name)),
          };
          const existing = byName.get(key);
          if (existing) existing.push(entry);
          else byName.set(key, [entry]);
          cards++;
        }
        if (list.length < 250) break;
        page++;
      }
    } catch (err) {
      failed.push(`${set.id} (${err.message})`);
    }
  }

  console.log(`· pokemontcg.io: ${cards.toLocaleString('de-CH')} Karten geladen`);
  if (failed.length) {
    console.warn(`· ${failed.length} Sets nicht abrufbar, die ersten drei: ${failed.slice(0, 3).join(' | ')}`);
  }
  if (stoppedEarly) {
    console.warn(
      `· Zeitgrenze von ${(TIME_BUDGET_MS / 60000).toFixed(0)} Minuten erreicht – es wird mit den bereits ` +
        'geladenen Sets zugeordnet. Der nächste Lauf holt den Rest.',
    );
  }
  if (cards === 0) throw new Error('Kein einziges Set abrufbar – Zuordnung nicht möglich.');
  return { setsById, byName };
}

/** Erst der feste Datenbestand, bei Ausfall die API. */
async function loadKnownCards() {
  try {
    return await loadFromDataFiles();
  } catch (err) {
    console.warn(`· Datenbestand nicht abrufbar (${err.message}), versuche die API`);
    return loadFromApi();
  }
}

/**
 * Wählt unter mehreren Drucken derselben Karte den gemeinten aus.
 *
 * Erste Wahl sind die Attacken aus dem Cardmarket-Namen – sie benennen den Druck
 * eindeutig. Fehlen sie (Trainer, Energie), entscheidet der Zusatz (V1)/(V2),
 * sonst der erste Druck nach Sammlernummer.
 */
export function choosePrinting(printings, product) {
  const wanted = product.attacks ?? [];
  let candidates = printings;

  if (wanted.length > 0) {
    const scored = printings.map((printing) => {
      const have = printing.attacks ?? [];
      const shared = wanted.filter((attack) => have.includes(attack)).length;
      // Gleich viele Treffer: der Druck mit genau diesen Attacken passt besser
      return { printing, rank: shared * 2 + (shared === wanted.length && have.length === wanted.length ? 1 : 0) };
    });
    const top = Math.max(...scored.map((entry) => entry.rank));
    if (top > 0) candidates = scored.filter((entry) => entry.rank === top).map((entry) => entry.printing);
  }

  // Bleiben mehrere übrig, sind es alternative Illustrationen derselben Karte.
  // Cardmarket zählt sie mit (V1), (V2) durch – in der Reihenfolge der Nummern.
  return candidates[Math.min(product.variant ?? 1, candidates.length) - 1];
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
    productsByExpansion
      .get(expansionId)
      .push({ id, key, variant: variantOf(product.name), attacks: attacksOf(product.name) });
  }
  console.log(`· Cardmarket: ${products.length.toLocaleString('de-CH')} Produkte in ${groups.size} Editionen`);

  const { setsById, byName } = await loadKnownCards();
  const matched = matchExpansions(groups, byName);
  console.log(`· ${matched.size} von ${groups.size} Editionen zugeordnet`);

  const meta = {};
  for (const [expansionId, match] of matched) {
    const set = setsById.get(match.setId);
    // Der PTCGO-Code ist das Kürzel, das im Laden verwendet wird
    const code = (set?.ptcgoCode ?? set?.id ?? '').toUpperCase();
    for (const product of productsByExpansion.get(expansionId) ?? []) {
      const printings = (byName.get(product.key) ?? [])
        .filter((entry) => entry.setId === match.setId)
        .sort((a, b) => numeric(a.number) - numeric(b.number));
      if (printings.length === 0) continue;
      const card = choosePrinting(printings, product);
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
