#!/usr/bin/env node
/**
 * Prüft die Zuordnung der Pokémon-Editionen.
 *
 * Der wichtigste Fall steht ganz oben: Namen in nicht-lateinischer Schrift.
 * Die Normalisierung strich lange alles ausser a–z und 0–9 – japanische,
 * koreanische und chinesische Kartennamen wurden dadurch zum leeren Schlüssel,
 * und solche Editionen konnten grundsätzlich nicht erkannt werden. Genau das
 * soll hier nie wieder unbemerkt zurückkommen.
 *
 * Aufruf: node scripts/test-pokemon.mjs
 */
import { matchExpansions, normalizeName, attacksOf, variantOf, choosePrinting } from './enrich-pokemon.mjs';

let ok = 0;
const fehler = [];

function pruefe(name, ist, soll) {
  if (JSON.stringify(ist) === JSON.stringify(soll)) ok++;
  else fehler.push(`${name}: ${JSON.stringify(ist)} statt ${JSON.stringify(soll)}`);
}

// ---------------------------------------------------------------- Schriften
pruefe('Japanisch bleibt erhalten', normalizeName('メガヤンマex'), 'メガヤンマex');
pruefe('Koreanisch bleibt erhalten', normalizeName('리자몽'), '리자몽');
pruefe('Chinesisch bleibt erhalten', normalizeName('噴火龍'), '噴火龍');
// Ein pauschales NFD würde das Dakuten abtrennen und wegstreichen – aus ガ
// würde カ, zwei verschiedene Karten fielen zusammen.
pruefe(
  'Dakuten unterscheidet weiterhin',
  normalizeName('ガブリアス') === normalizeName('カブリアス'),
  false,
);
pruefe('Lateinische Akzente fallen weg', normalizeName('Pokémon Trainer'), 'pokemon trainer');
pruefe('Deutsche Namen', normalizeName('Mega-Bisaflor-ex'), 'mega bisaflor ex');
pruefe('Mega-Schreibweise', normalizeName('MAggron EX'), 'm aggron ex');
pruefe('Klammern und Attacken raus', normalizeName('Pikachu (V1) [Thunder Shock]'), 'pikachu');

// ------------------------------------------------------------ Zusatzangaben
pruefe('Attacken gelesen', attacksOf('Pikachu [Thunder Shock | Quick Attack]'), [
  'thunder shock',
  'quick attack',
]);
pruefe('Variante gelesen', variantOf('Pikachu (V2)'), 2);
pruefe('Variante ohne Angabe', variantOf('Pikachu'), 1);

// ------------------------------------------------------- Editionszuordnung
const byName = new Map();
const add = (name, setId, number, attacks = []) => {
  const key = normalizeName(name);
  byName.set(key, [...(byName.get(key) ?? []), { setId, number, rarity: 'Rare', attacks }]);
};

// Ein japanisches Set – der Fall, der bisher scheiterte
const japanisch = ['ヒビキのカイロス', 'ヤンヤンマ', 'メガヤンマex', 'ロケット団のダグトリオ', 'バーベナとヘレナ', 'ピカチュウ'];
japanisch.forEach((name, i) => add(name, 'M2a', String(i + 1).padStart(3, '0')));
// Ein englisches Set mit teils gleichen Namen wie ein Nachdruck
const englisch = ['Bulbasaur', 'Ivysaur', 'Venusaur', 'Charmander', 'Charmeleon', 'Charizard'];
englisch.forEach((name, i) => add(name, 'me01', String(i + 1).padStart(3, '0')));
englisch.slice(0, 3).forEach((name, i) => add(name, 'base1', String(50 + i)));

const setSizes = new Map([
  ['M2a', japanisch.length],
  ['me01', englisch.length],
  ['base1', 3],
]);

const treffer = matchExpansions(
  new Map([
    [1, japanisch.map(normalizeName)],
    [2, englisch.map(normalizeName)],
    [3, Array.from({ length: 30 }, (_, i) => normalizeName(`Sammelkoffer ${i}`))],
  ]),
  byName,
  setSizes,
);

pruefe('Japanische Edition erkannt', treffer.get(1)?.setId, 'M2a');
pruefe('Englische Edition erkannt', treffer.get(2)?.setId, 'me01');
pruefe('Unbekannte Edition bleibt offen', treffer.has(3), false);

// ------------------------------------------------- Auswahl unter Nachdrucken
const drucke = [
  { setId: 'x', number: '001', attacks: ['thunder shock'] },
  { setId: 'x', number: '002', attacks: ['quick attack'] },
];
pruefe(
  'Attacke entscheidet den Druck',
  choosePrinting(drucke, { attacks: ['quick attack'], variant: 1 })?.number,
  '002',
);
pruefe('Ohne Attacke entscheidet die Variante', choosePrinting(drucke, { variant: 2 })?.number, '002');

// ------------------------------------------------------------------ Ausgabe
console.log(`${ok} bestanden, ${fehler.length} fehlgeschlagen`);
for (const zeile of fehler) console.log(`  FEHLER ${zeile}`);
process.exit(fehler.length === 0 ? 0 : 1);
