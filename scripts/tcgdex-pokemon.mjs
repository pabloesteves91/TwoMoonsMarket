/**
 * Liest den Kartenbestand von TCGdex und verdichtet ihn zu einer Datei, die
 * `enrich-pokemon.mjs` weiterverarbeiten kann.
 *
 * Warum diese Quelle:
 *
 * Die bisher genutzte Sammlung (pokemontcg.io) kennt rund 20 000 Karten, fast
 * ausschliesslich englische Ausgaben. Cardmarket führt aber gut 73 000
 * Pokémon-Produkte, darunter viele japanische Sets und Promos – für die stand
 * im Laden deshalb "Cardmarket #3125" statt eines Set-Kürzels.
 *
 * TCGdex kennt rund 42 000 Karten in beiden Welten (data = international,
 * data-asia = japanisch) und – das ist der eigentliche Gewinn – bei vielen
 * Sets die **Cardmarket-Editions-Nummer**. Wo die vorliegt, muss nichts mehr
 * über Namen erraten werden: die Zuordnung ist dann schlicht bekannt.
 *
 * Ausgabe: eine JSON-Datei mit
 *   sets:  je Set Kürzel, Name, Kartenzahl und (wenn bekannt) Cardmarket-ID
 *   cards: je Karte Set, Nummer, Namen in allen Sprachen, Attackennamen
 *
 * Aufruf: node scripts/tcgdex-pokemon.mjs <klonverzeichnis> <ausgabedatei>
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exit } from 'node:process';

/** Sprachen, in denen Cardmarket Karten führt. */
const LANGUAGES = ['en', 'de', 'fr', 'it', 'es', 'pt', 'ja', 'ko', 'zh-tw', 'zh-cn'];

/**
 * Liest einen Textblock wie `name: { en: "Pikachu", de: "Pikachu" }`.
 *
 * Bewusst über Muster statt über einen TypeScript-Parser: die Dateien sind
 * maschinell erzeugt und folgen einer engen Form, und ein Parser für 42 000
 * Dateien wäre um ein Vielfaches langsamer.
 */
function readNames(text, field) {
  const start = text.indexOf(`${field}:`);
  if (start < 0) return {};
  const open = text.indexOf('{', start);
  if (open < 0) return {};
  let depth = 0;
  let end = open;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const block = text.slice(open, end + 1);
  const names = {};
  for (const lang of LANGUAGES) {
    const match = block.match(new RegExp(`['"]?${lang}['"]?\\s*:\\s*(['"])((?:\\\\.|(?!\\1).)*)\\1`));
    if (match) names[lang] = match[2].replace(/\\(['"])/g, '$1');
  }
  return names;
}

/** Einfaches Feld wie `id: 'ADV1'` oder `cardmarket: 6209`. */
function readField(text, field) {
  const match = text.match(new RegExp(`(?:^|[\\s{,])${field}\\s*:\\s*(?:(['"])((?:\\\\.|(?!\\1).)*)\\1|(\\d+))`, 'm'));
  if (!match) return undefined;
  return match[2] ?? match[3];
}

/** Alle Attackennamen einer Karte – sie unterscheiden gleichnamige Drucke. */
function readAttackNames(text) {
  const namen = [];
  const start = text.indexOf('attacks:');
  if (start < 0) return namen;
  const block = text.slice(start);
  for (const match of block.matchAll(/name:\s*\{[^}]*?en:\s*(['"])((?:\\.|(?!\1).)*)\1/gs)) {
    namen.push(match[2].replace(/\\(['"])/g, '$1'));
  }
  return namen;
}

/** Verzeichnisse einer Sammlung: je Serie eine Set-Datei plus Kartenordner. */
function collectSets(root, base) {
  const sets = [];
  let series;
  try {
    series = readdirSync(join(root, base), { withFileTypes: true });
  } catch {
    return sets;
  }
  for (const serie of series) {
    if (!serie.isDirectory()) continue;
    const dir = join(root, base, serie.name);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue;
      sets.push({
        region: base === 'data-asia' ? 'asia' : 'intl',
        serie: serie.name,
        file: join(dir, file),
        cardDir: join(dir, file.slice(0, -3)),
      });
    }
  }
  return sets;
}

export function buildIndex(root) {
  const sets = [];
  const cards = [];

  for (const base of ['data', 'data-asia']) {
    for (const entry of collectSets(root, base)) {
      let text;
      try {
        text = readFileSync(entry.file, 'utf8');
      } catch {
        continue;
      }
      const id = readField(text, 'id');
      if (!id) continue;

      const names = readNames(text, 'name');
      // Das Kürzel steht im Laden auf dem Kärtchen. Fehlt es (viele japanische
      // Sets führen keines), dient die Set-Kennung als Kürzel – immer noch
      // besser als "Cardmarket #3125".
      const abbreviation = text.match(/abbreviations:\s*\{[^}]*official:\s*['"]([^'"]+)['"]/s)?.[1];
      const cardmarket = text.match(/thirdParty:\s*\{[^}]*cardmarket:\s*(\d+)/s)?.[1];

      const setEntry = {
        id,
        region: entry.region,
        serie: entry.serie,
        code: (abbreviation ?? id).toUpperCase(),
        name: names.en ?? names.ja ?? entry.serie,
        cardmarketExpansionId: cardmarket ? Number(cardmarket) : undefined,
        cardCount: 0,
      };

      let files = [];
      try {
        files = readdirSync(entry.cardDir).filter((file) => file.endsWith('.ts'));
      } catch {
        // Set ohne Kartenordner (angekündigt, aber noch ohne Inhalt)
      }

      for (const file of files) {
        let cardText;
        try {
          cardText = readFileSync(join(entry.cardDir, file), 'utf8');
        } catch {
          continue;
        }
        const cardNames = readNames(cardText, 'name');
        if (Object.keys(cardNames).length === 0) continue;
        cards.push({
          setId: id,
          number: file.slice(0, -3),
          names: cardNames,
          attacks: readAttackNames(cardText),
        });
        setEntry.cardCount++;
      }

      sets.push(setEntry);
    }
  }

  return { sets, cards };
}

async function main() {
  const [, , root, target] = process.argv;
  if (!root || !target) {
    console.error('Aufruf: node scripts/tcgdex-pokemon.mjs <klonverzeichnis> <ausgabedatei>');
    exit(1);
  }

  const { sets, cards } = buildIndex(root);
  const mitCardmarket = sets.filter((set) => set.cardmarketExpansionId !== undefined);

  // Wie bei den anderen Anreicherungen: eine leere Datei würde die Sets
  // stillschweigend wieder entfernen. Dann lieber abbrechen und den letzten
  // Stand behalten.
  if (cards.length < 10000) {
    console.error(`Nur ${cards.length} Karten gelesen – das kann nicht stimmen. Die Datei wird nicht geschrieben.`);
    exit(1);
  }

  writeFileSync(target, JSON.stringify({ sets, cards }));
  console.log(
    `✓ TCGdex: ${sets.length} Sets (${mitCardmarket.length} mit Cardmarket-Nummer), ` +
      `${cards.length.toLocaleString('de-CH')} Karten → ${target}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
