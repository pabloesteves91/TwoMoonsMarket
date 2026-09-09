#!/usr/bin/env node
/**
 * Holt den Kurs Euro → Franken und legt ihn zur Preisliste.
 *
 * Cardmarket rechnet in Euro, ausgepreist wird im Laden in Franken. Ein von
 * Hand gepflegter Kurs veraltet unbemerkt und verfälscht damit jeden Preis –
 * deshalb kommt er mit demselben wöchentlichen Lauf wie die Preise.
 *
 * Quelle ist der Referenzkurs der Europäischen Zentralbank. Antwortet sie
 * nicht, dient Frankfurter als Ausweichweg (dieselben EZB-Daten als JSON).
 * Schlägt beides fehl, wird der zuletzt veröffentlichte Kurs von der Live-Seite
 * übernommen – sonst verlören alle Geräte den automatischen Kurs, nur weil eine
 * Quelle gerade nicht erreichbar war. Die frisch gebaute index.json enthält ihn
 * nämlich nicht: sie wird im Lauf davor neu geschrieben.
 *
 * Nutzung: node scripts/fetch-rate.mjs [ordner]   (Standard: dist/prices)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const dir = argv[2] ?? 'dist/prices';
const UA = 'TwoMoonsMarket/0.1 (+https://github.com/pabloesteves91/TwoMoonsMarket)';
const ECB = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const FALLBACK = 'https://api.frankfurter.app/latest?from=EUR&to=CHF';
const LIVE = process.env.LIVE_URL ?? '';

/** Liest den CHF-Kurs aus der EZB-Tagesdatei. */
export function parseEcb(xml) {
  const kurs = /currency=['"]CHF['"]\s+rate=['"]([\d.]+)['"]/.exec(xml)
    ?? /rate=['"]([\d.]+)['"]\s+currency=['"]CHF['"]/.exec(xml);
  const datum = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml);
  if (!kurs) return null;
  const wert = Number(kurs[1]);
  return Number.isFinite(wert) && wert > 0 ? { rate: wert, date: datum?.[1] } : null;
}

/** Zeitgrenze je Quelle: der Deploy darf an einem Kursabruf nicht hängen. */
const TIMEOUT_MS = 15_000;

async function holen(url, wandeln) {
  const antwort = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
  return wandeln(await antwort.text());
}


/**
 * Liest den Kurs aus der Fassung, die gerade veröffentlicht ist.
 *
 * Die lokale index.json taugt dafür nicht: sie wurde im Schritt davor neu
 * geschrieben und trägt nur Dateien und Zeitstempel.
 */
async function letzterVeroeffentlichterKurs() {
  if (!LIVE) return null;
  try {
    const antwort = await fetch(`${LIVE}/prices/index.json`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!antwort.ok) return null;
    const daten = await antwort.json();
    const wert = Number(daten?.rates?.eurToChf);
    return Number.isFinite(wert) && wert > 0 ? daten.rates : null;
  } catch {
    return null;
  }
}

async function main() {
  let index;
  try {
    index = JSON.parse(await readFile(`${dir}/index.json`, 'utf8'));
  } catch {
    console.error(`Kein index.json in ${dir} – kein Kurs zu hinterlegen.`);
    exit(0);
  }

  const wege = [
    ['EZB', ECB, (text) => parseEcb(text)],
    ['Frankfurter', FALLBACK, (text) => {
      const daten = JSON.parse(text);
      const wert = Number(daten?.rates?.CHF);
      return Number.isFinite(wert) && wert > 0 ? { rate: wert, date: daten.date } : null;
    }],
  ];

  for (const [name, url, wandeln] of wege) {
    try {
      const treffer = await holen(url, wandeln);
      if (!treffer) throw new Error('Kein CHF-Kurs in der Antwort');
      index.rates = {
        eurToChf: Math.round(treffer.rate * 10000) / 10000,
        source: name,
        date: treffer.date ?? new Date().toISOString().slice(0, 10),
        fetchedAt: new Date().toISOString(),
      };
      await writeFile(`${dir}/index.json`, JSON.stringify(index, null, 2), 'utf8');
      console.log(`✓ Kurs 1 EUR = ${index.rates.eurToChf} CHF (${name}, Stand ${index.rates.date})`);
      return;
    } catch (err) {
      console.warn(`· ${name} lieferte keinen Kurs (${err.message})`);
    }
  }

  // Keine Quelle erreichbar: den zuletzt veröffentlichten Kurs übernehmen.
  const alt = await letzterVeroeffentlichterKurs();
  if (alt) {
    index.rates = { ...alt, carriedOver: true };
    await writeFile(`${dir}/index.json`, JSON.stringify(index, null, 2), 'utf8');
    console.warn(`· Kein neuer Kurs – der veröffentlichte bleibt: ${alt.eurToChf} vom ${alt.date}`);
    return;
  }
  console.warn('· Kein Kurs hinterlegt – die App nimmt den in den Einstellungen gepflegten Wert.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Kursabruf fehlgeschlagen:', err.message);
    exit(0);
  });
}
