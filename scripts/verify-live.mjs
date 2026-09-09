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
console.log(`Veröffentlicht: ${index.files.length} Datei(en), Stand ${index.createdAt ?? 'unbekannt'}`);

// Der Kurs gehört seit der Franken-Umstellung zur Veröffentlichung: fehlt er,
// rechnen alle Geräte mit dem Wert aus ihren Einstellungen weiter.
if (index.rates?.eurToChf) {
  const { eurToChf, source, date, carriedOver } = index.rates;
  console.log(
    `Kurs: 1 EUR = ${eurToChf} CHF (${source}, Stand ${date})${carriedOver ? ' – übernommen, keine Quelle erreichbar' : ''}`,
  );
  console.log(`  Probe: 10.00 EUR Trend +15 % → ${(Math.ceil(10 * 1.15 * eurToChf * 10) / 10).toFixed(2)} CHF`);
} else {
  console.log('Kurs: FEHLT – die Geräte nehmen den in den Einstellungen gepflegten Wert.');
}

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

  // Entscheidend ist nicht der Schnitt über alle Karten, sondern über die
  // wertvollen: nach denen wird im Laden ausgepreist.
  for (const grenze of [5, 20, 100]) {
    const teuer = rows.filter((row) => (row.trend ?? row.avg ?? 0) >= grenze);
    const davon = teuer.filter((row) => row.expansion).length;
    console.log(
      `  ab ${grenze} EUR: ${davon.toLocaleString('de-CH')} von ${teuer.length.toLocaleString('de-CH')} mit Set ` +
        `(${teuer.length ? ((davon / teuer.length) * 100).toFixed(0) : 0} %)`,
    );
  }

  for (const name of gesucht[file.game] ?? []) {
    const treffer = rows.filter((row) => (row.name ?? '').toLowerCase().includes(name));
    if (treffer.length === 0) {
      console.log(`  "${name}": nicht gefunden`);
      continue;
    }
    const ohne = treffer.filter((row) => !row.expansion).length;
    console.log(`  "${name}": ${treffer.length} Einträge, ${ohne} ohne Set`);
    for (const row of treffer.slice(0, 4)) {
      const set = row.expansion ? `${row.expansion} · Nr. ${row.number ?? '?'}` : 'OHNE SET';
      console.log(`    ${row.name} → ${set}  (${row.trend ?? row.avg ?? '–'} EUR)`);
    }
  }
}
