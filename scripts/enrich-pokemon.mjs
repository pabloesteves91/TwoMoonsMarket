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
 * Datenquellen, in dieser Reihenfolge:
 *
 * 1. TCGdex (`scripts/tcgdex-pokemon.mjs`). Kennt rund 40 000 Karten in beiden
 *    Welten – international und japanisch – und bei vielen Sets die
 *    **Cardmarket-Editions-Nummer**. Wo die vorliegt, muss gar nichts geraten
 *    werden: die Edition ist dann schlicht bekannt. Ausserdem führt TCGdex die
 *    Kartennamen in allen Sprachen, was den Abgleich der übrigen Editionen
 *    deutlich verbessert – Cardmarket benennt japanische Karten japanisch.
 * 2. pokemontcg.io als Rückfall, falls die erste Quelle fehlt. Rund 20 000
 *    Karten, fast nur englische Ausgaben.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const dir = argv[2] ?? 'dist/prices';
/** Von scripts/tcgdex-pokemon.mjs erzeugt; fehlt sie, greifen die alten Quellen. */
const TCGDEX_FILE = process.env.TCGDEX_FILE ?? '';
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
/** Anteil der Cardmarket-Produkte, die im Set liegen müssen. */
export const MATCH_MIN_SHARE = 0.5;
/**
 * Anteil des Sets, der von der Edition abgedeckt sein muss.
 *
 * Ohne diese zweite Richtung gewinnt bei den frühen Ausgaben das falsche Set:
 * die Karten des Base Sets stehen auch in den Nachdrucken, und ein grosses
 * Nachdruck-Set bekommt dadurch ebenso viele Stimmen. Erst die Frage "wie viel
 * des Sets steckt in dieser Edition?" trennt beide sauber. Kleinere Schwelle als
 * oben, weil Cardmarket grosse Promo-Sets auf mehrere Editionen aufteilt.
 */
export const MATCH_MIN_COVERAGE = 0.35;

/**
 * Vereinheitlicht Kartennamen: Zusätze in Klammern und Sonderzeichen raus.
 *
 * Cardmarket hängt bei Pokémon die Attacken in eckigen Klammern an –
 * "Ninetales [Lure | Fire Blast]". Ohne sie zu entfernen findet kein einziger
 * dieser Namen seine Karte.
 */
/**
 * Entfernt Akzente, aber nur auf lateinischen Buchstaben.
 *
 * Ein pauschales NFD über den ganzen Namen wäre für Japanisch verhängnisvoll:
 * es zerlegt auch das Dakuten, und ein anschliessendes Streichen der
 * Kombinationszeichen macht aus ガ ein カ – zwei verschiedene Karten würden zu
 * einer.
 */
function stripLatinAccents(text) {
  return text.replace(/[\u00c0-\u024f]/g, (ch) => ch.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
}

export function normalizeName(name) {
  return String(name)
    // Mega-Karten: Cardmarket schreibt "MAggron EX", die Kartendaten "M Aggron-EX"
    .replace(/\bM(?=[A-Z][a-z])/g, 'M ')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    // Voll- und Halbbreite vereinheitlichen – japanische Quellen mischen beides
    .normalize('NFKC')
    .replace(/[\u00c0-\u024f]/g, (ch) => stripLatinAccents(ch))
    // Buchstaben und Ziffern **jeder** Schrift behalten. Vorher stand hier
    // [^a-z0-9]: das löschte japanische, koreanische und chinesische Namen
    // restlos, alle wurden zum selben leeren Schlüssel – solche Editionen
    // konnten deshalb nie erkannt werden.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
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
export function matchExpansions(groups, setsByName, setSizes = new Map()) {
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
    // Bewertet wird beides zugleich: wie viel der Edition im Set liegt und wie
    // viel des Sets die Edition abdeckt. Das harmonische Mittel bestraft es,
    // wenn eine der beiden Richtungen schwach ist.
    let best = null;
    for (const [setId, score] of votes) {
      const share = score / names.length;
      const coverage = score / (setSizes.get(setId) || score);
      const rating = (2 * share * coverage) / (share + coverage);
      if (!best || rating > best.rating) best = { setId, score, share, coverage, rating };
    }
    if (!best) continue;
    if (
      best.score >= MATCH_MIN_CARDS &&
      best.share >= MATCH_MIN_SHARE &&
      best.coverage >= MATCH_MIN_COVERAGE
    ) {
      result.set(expansionId, best);
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
 * Liest die von `scripts/tcgdex-pokemon.mjs` erzeugte Datei.
 *
 * Gibt dieselbe Form zurück wie die anderen Quellen, dazu `byCardmarketId`:
 * die Editionen, deren Zuordnung bekannt ist und die deshalb nicht über
 * Namen erraten werden müssen.
 */
async function loadFromTcgdex(file) {
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const sets = raw.sets ?? [];
  const cards = raw.cards ?? [];
  if (sets.length === 0 || cards.length === 0) throw new Error('TCGdex-Datei ist leer');

  const setsById = new Map(
    sets.map((set) => [set.id, { id: set.id, name: set.name, ptcgoCode: set.code, region: set.region }]),
  );
  const setSizes = new Map(sets.map((set) => [set.id, set.cardCount]));
  const byCardmarketId = new Map();
  for (const set of sets) {
    if (set.cardmarketExpansionId) byCardmarketId.set(set.cardmarketExpansionId, set.id);
  }

  // Ein Eintrag je Karte, aber unter jedem seiner Sprachnamen auffindbar:
  // Cardmarket führt eine japanische Karte japanisch, eine deutsche deutsch.
  const byName = new Map();
  for (const card of cards) {
    const entry = {
      setId: card.setId,
      number: card.number,
      rarity: card.rarity,
      attacks: (card.attacks ?? []).map((attack) => normalizeName(attack)),
    };
    for (const name of new Set(Object.values(card.names ?? {}))) {
      const key = normalizeName(name);
      if (!key) continue;
      const existing = byName.get(key);
      if (existing) existing.push(entry);
      else byName.set(key, [entry]);
    }
  }

  console.log(
    `· TCGdex: ${sets.length} Sets (${byCardmarketId.size} mit Cardmarket-Nummer), ` +
      `${cards.length.toLocaleString('de-CH')} Karten`,
  );
  return { setsById, byName, setSizes, byCardmarketId };
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
  const setSizes = new Map();
  const failed = [];
  let cards = 0;

  const queue = [...sets];
  const deadline = Date.now() + TIME_BUDGET_MS;
  const worker = async () => {
    for (let set = queue.shift(); set; set = queue.shift()) {
      if (Date.now() > deadline) return;
      try {
        const list = await getJson(`${DATA}/cards/en/${set.id}.json`);
        setSizes.set(set.id, (list ?? []).length);
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
  return { setsById, byName, setSizes };
}

/** Rückfalllösung: dieselben Daten über die API, Set für Set und Seite für Seite. */
async function loadFromApi() {
  const sets = (await getJson(`${API}/sets?pageSize=250`)).data ?? [];
  console.log(`· pokemontcg.io: ${sets.length} Sets`);

  const setsById = new Map(sets.map((set) => [set.id, set]));
  const byName = new Map();
  const setSizes = new Map();
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
        setSizes.set(set.id, (setSizes.get(set.id) ?? 0) + list.length);
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
  return { setsById, byName, setSizes };
}

/** Erst TCGdex, dann der feste Datenbestand, bei Ausfall die API. */
async function loadKnownCards() {
  if (TCGDEX_FILE) {
    try {
      return await loadFromTcgdex(TCGDEX_FILE);
    } catch (err) {
      console.warn(`· TCGdex nicht lesbar (${err.message}), weiter mit pokemontcg.io`);
    }
  }
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
    // Ein Name, von dem nichts übrig bleibt, darf nicht mitstimmen – sonst
    // stimmen alle solchen Produkte füreinander.
    if (!key) continue;
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

  const { setsById, byName, setSizes, byCardmarketId } = await loadKnownCards();

  // Editionen, deren Cardmarket-Nummer die Quelle mitliefert, sind bekannt –
  // die brauchen kein Raten. Nur der Rest geht durch den Namensabgleich.
  const direkt = new Map();
  const offen = new Map();
  for (const [expansionId, names] of groups) {
    const setId = byCardmarketId?.get(expansionId);
    if (setId && setsById.has(setId)) direkt.set(expansionId, { setId, votes: names.length, share: 1 });
    else offen.set(expansionId, names);
  }

  const geraten = matchExpansions(offen, byName, setSizes);
  const matched = new Map([...direkt, ...geraten]);
  console.log(
    `· ${matched.size} von ${groups.size} Editionen zugeordnet ` +
      `(${direkt.size} über die Cardmarket-Nummer, ${geraten.size} über Namen)`,
  );

  // Was fehlt, und wie Cardmarket es benennt. Ohne diese Zeilen bleibt der
  // Rest Raterei: die Editionsliste von Cardmarket ist gesperrt (403), also
  // sind die Produktnamen der einzige Hinweis darauf, um welches Set es geht
  // und in welcher Sprache es geführt wird.
  const offeneListe = [...offen.entries()]
    .map(([expansionId, names]) => ({ expansionId, anzahl: names.length }))
    .sort((a, b) => b.anzahl - a.anzahl)
    .slice(0, 12);
  if (offeneListe.length > 0) {
    console.log('· Grösste nicht zugeordnete Editionen (Nummer, Produkte, Beispielnamen):');
    for (const { expansionId, anzahl } of offeneListe) {
      const beispiele = (productsByExpansion.get(expansionId) ?? [])
        .slice(0, 3)
        .map((product) => product.key)
        .join(' | ');
      console.log(`    ${expansionId}  ${String(anzahl).padStart(5)}  ${beispiele}`);
    }
  }

  const meta = {};
  let mitNummer = 0;
  let nurSet = 0;
  for (const [expansionId, match] of matched) {
    const set = setsById.get(match.setId);
    // Der PTCGO-Code ist das Kürzel, das im Laden verwendet wird
    const code = (set?.ptcgoCode ?? set?.id ?? '').toUpperCase();
    if (!code) continue;
    for (const product of productsByExpansion.get(expansionId) ?? []) {
      const printings = (byName.get(product.key) ?? [])
        .filter((entry) => entry.setId === match.setId)
        .sort((a, b) => numeric(a.number) - numeric(b.number));

      // Das Set steht fest, sobald die Edition erkannt ist – es hängt nicht
      // daran, ob sich diese eine Karte namentlich wiederfinden lässt. Genau
      // daran scheiterte es bisher: japanische Ausgaben führt Cardmarket unter
      // englischem Namen, die japanische Quelle kennt nur den japanischen. Die
      // Edition war damit sicher bekannt, das Produkt bekam trotzdem nichts.
      // Ein Kürzel ohne Nummer ist im Laden immer noch weit besser als
      // "Cardmarket #3125".
      if (printings.length === 0) {
        meta[product.id] = { set: code, setName: set?.name };
        nurSet++;
        continue;
      }
      const card = choosePrinting(printings, product);
      meta[product.id] = { set: code, setName: set?.name, number: card.number, rarity: card.rarity };
      mitNummer++;
    }
  }

  // Wie bei Magic: eine leere Datei würde die Sets stillschweigend wieder
  // entfernen. Dann lieber abbrechen und den letzten Stand behalten.
  if (Object.keys(meta).length === 0) {
    throw new Error(`Keine einzige Karte zugeordnet (${matched.size} von ${groups.size} Editionen erkannt).`);
  }

  const file = 'product-meta-pokemon.json';
  await writeFile(`${dir}/${file}`, JSON.stringify(meta), 'utf8');
  console.log(
    `✓ Pokémon: ${Object.keys(meta).length.toLocaleString('de-CH')} Karten mit Set → ${file} ` +
      `(${mitNummer.toLocaleString('de-CH')} auch mit Nummer, ${nurSet.toLocaleString('de-CH')} nur mit Kürzel)`,
  );

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
