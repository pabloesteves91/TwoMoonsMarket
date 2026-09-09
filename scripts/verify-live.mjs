#!/usr/bin/env node
/**
 * Prüft, was tatsächlich veröffentlicht ist.
 *
 * Läuft im CI, weil die Live-Adresse von aussen nicht erreichbar ist. Der Lauf
 * lädt die veröffentlichte Preisliste und sucht darin die Karten, die in der App
 * ohne Set angezeigt wurden.
 */
const BASE = process.env.LIVE_URL ?? 'https://twomoonsmarket-c7649.web.app';

const get = async (url) => {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.json();
};

const index = await get(`${BASE}/prices/index.json`);
console.log(`Veröffentlicht: ${index.files.length} Datei(en), Stand ${index.generatedAt ?? index.version ?? 'unbekannt'}`);

const gesucht = {
  magic: ['heliophial', 'helionaut', 'helios one', 'gideon, ally of zendikar'],
  pokemon: ['pikachu', 'charizard ex', 'iono'],
};

for (const file of index.files) {
  const daten = await get(`${BASE}/prices/${file.file}`);
  const rows = Array.isArray(daten) ? daten : (daten.priceGuides ?? daten.rows ?? []);
  const mitSet = rows.filter((row) => row.expansion).length;
  const mitNummer = rows.filter((row) => row.number).length;
  console.log(
    `\n${file.game}: ${rows.length.toLocaleString('de-CH')} Karten, ` +
      `${mitSet.toLocaleString('de-CH')} mit Set (${((mitSet / rows.length) * 100).toFixed(0)} %), ` +
      `${mitNummer.toLocaleString('de-CH')} mit Nummer`,
  );

  for (const name of gesucht[file.game] ?? []) {
    const treffer = rows.filter((row) => (row.name ?? '').toLowerCase().includes(name)).slice(0, 3);
    if (treffer.length === 0) {
      console.log(`  "${name}": nicht gefunden`);
      continue;
    }
    for (const row of treffer) {
      const set = row.expansion ? `${row.expansion} · Nr. ${row.number ?? '?'}` : 'OHNE SET';
      console.log(`  ${row.name} → ${set}  (${row.trend ?? row.avg ?? '–'} EUR)`);
    }
  }
}
