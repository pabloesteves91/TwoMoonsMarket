# TwoMoons Market

TCG Collector & Preis-Tracker für **TwoMoons AG, Dübendorf**.
Karten erfassen, Cardmarket-Preise importieren und Verkaufspreise automatisch mit
Aufschlag (Standard **+15 %**) berechnen – responsiv für Desktop und Handy, ohne Login.

Aktuell unterstützte Spiele: **Magic: The Gathering** und **Pokémon**; weitere TCGs
lassen sich in den Einstellungen ergänzen.

## Schnellstart

```bash
npm install
npm run dev          # http://localhost:5173
```

Zum Ausprobieren: *Einstellungen → Demo-Daten laden*. Danach zeigen Dashboard und
Bestand realistische Beispielwerte.

Produktions-Build:

```bash
npm run build        # Ergebnis in dist/
npm run preview
```

`dist/` ist eine rein statische Seite und läuft auf Firebase Hosting, Netlify,
Vercel, GitHub Pages oder jedem Webserver. Die App nutzt Hash-Routing, es sind
also keine Server-Rewrites nötig.

## Funktionen

| Bereich | Inhalt |
| --- | --- |
| **Dashboard** | Kartenanzahl, Verkaufswert, Einkaufswert, Marge, wertvollste Positionen, Stand der Preisliste |
| **Bestand** | Zustand (MT–PO), Sprache, Foil, Menge, Lagerort, Einkaufspreis, Fixpreis, Notiz, Foto; Suche, Filter, Sortierung; CSV-Export |
| **Preise** | Import der Cardmarket-Preisliste (JSON/CSV, Drag & Drop), Suche in der Preisliste mit berechnetem Verkaufspreis |
| **Regeln** | Getrennte Preisregeln für Foil und Non-Foil, Sonderregeln pro Set und pro Karte, optionale Zustandsfaktoren |
| **Einstellungen** | Währung EUR/CHF, Spiele verwalten, Backup exportieren/einlesen, Demo-Daten, Zurücksetzen |

### Preisberechnung

```
Verkaufspreis = Preisbasis × (1 + Aufschlag %) × Zustandsfaktor
                → gerundet → mindestens Mindestpreis
```

Die Regeln greifen von spezifisch nach allgemein:

1. **Fixpreis** am Bestandseintrag
2. **Eintrags-Regel** (nur dieser Bestandseintrag)
3. **Karten-Regel** (Sonderregel für eine Karte)
4. **Set-Regel** (Sonderregel für ein ganzes Set)
5. **Globale Regel** – je eine für Foil und Non-Foil

Als Preisbasis stehen alle Spalten der Cardmarket-Preisliste zur Verfügung:
`Trend Price` (Standard), `Avg. Sell Price`, `Ø 1/7/30 Tage`, `Low Price`,
`Low Price EX+`, `German Pro Low` und `Suggested Price`. Fehlt die gewählte Spalte
in einem Datensatz, wird automatisch auf die nächste verfügbare ausgewichen und
das in der Preisvorschau vermerkt.

**Zu NearMint und DACH:** Die Cardmarket-Preisliste enthält keine eigene
NM-DACH-Spalte. Die Preise beziehen sich grundsätzlich auf NM-Ware; die
DACH-nächste Spalte ist `German Pro Low`. Für schlechtere Zustände lassen sich
in *Regeln → Zustandsfaktoren* Abschläge aktivieren (Standard: NM 100 %, EX 85 %,
GD 70 %, LP 60 %, PL 45 %, PO 30 %).

**Währung:** Cardmarket rechnet in EUR, daher werden alle Preise intern in EUR
gespeichert. In den Einstellungen lässt sich die Anzeige auf CHF umstellen; der
Kurs wird dort manuell gepflegt.

## Preise importieren

Cardmarket bietet keine offene API, die Preisliste kommt deshalb als Datei in die App.

### Variante A – automatisch

```bash
npm run import:prices                 # Magic (1) + Pokémon (6)
npm run import:prices -- --games 1,6,3 --catalog --out ./data
```

Das Skript legt die Dateien in `data/` ab. Diese anschliessend in der App unter
**Preise** hochladen (Drag & Drop). Sperrt Cardmarket den direkten Abruf, bricht
das Skript mit einer Meldung ab – dann Variante B nutzen. Bitte vorab die
Nutzungsbedingungen von Cardmarket für automatisierte Abrufe prüfen.

### Variante B – manuell

Preisliste auf <https://www.cardmarket.com/en/Magic/Data/Price-Guide> herunterladen
und in der App unter **Preise** hochladen.

### Unterstützte Dateiformate

* **Price-Guide-JSON** (`{ "priceGuides": [{ "idProduct": …, "trend": … }] }`) –
  enthält nur Produkt-IDs; Kartennamen kommen aus dem Produkt-Katalog, der sich
  einfach zusätzlich hochladen lässt (die Datensätze werden über die Produkt-ID
  zusammengeführt).
* **Produkt-Katalog** (JSON oder CSV) mit `idProduct`, `name`, `expansion`.
* **Beliebige CSV** mit Namens- und Preisspalten. Header werden über Aliase erkannt
  (`Name`, `Expansion`/`Set`, `Trend Price`, `Avg. Sell Price`, `Foil Trend`, …),
  Trennzeichen (`;` `,` Tab `|`) und Zahlenformat (`1.234,56` wie `1234.56`)
  automatisch. Nach dem Import zeigt die App die erkannte Spaltenzuordnung an.

Beim erneuten Import werden bestehende Datensätze aktualisiert, nicht dupliziert –
auch dann, wenn eine Quelle Produkt-IDs liefert und die andere nur Namen.

## CSV-Export

Unter **Bestand → CSV exportieren** (exportiert immer die aktuell gefilterte Auswahl):

* **Vollständig** – alle Felder inkl. Preisbasis, Aufschlag, Marge
* **Shop-Import** – kompakte Spalten für den Shop-Upload
* **Cardmarket-Stil** – `idProduct`, Menge, Preis, Zustand, Sprache, Foil

## Datenhaltung & Login

Alle Daten liegen aktuell in der **IndexedDB des jeweiligen Browsers** – kein Server,
kein Login, nichts verlässt das Gerät. Entsprechend gilt: regelmässig
*Einstellungen → Backup exportieren*.

Der gesamte Datenzugriff läuft über das Interface `Repository`
(`src/db/repository.ts`). Für den späteren Mehrbenutzer-Betrieb mit Firebase muss
nur ein zweites Repository implementiert und in `src/db/index.ts` eingehängt werden –
die Oberfläche bleibt unverändert. Die konkreten Schritte inkl. empfohlener
Firestore-Struktur stehen in [`src/firebase/README.md`](src/firebase/README.md).

## Projektstruktur

```
scripts/import-prices.mjs   Download der Cardmarket-Preislisten
src/lib/pricing.ts          Preisregeln, Matching, Rundung
src/lib/cardmarket.ts       Import-Parser (JSON/CSV, Spaltenerkennung)
src/lib/exporters.ts        CSV-Export-Formate
src/db/                     Repository-Interface + IndexedDB-Implementierung
src/pages/                  Dashboard, Bestand, Preise, Regeln, Einstellungen
src/components/             Modal, Bestandsformular, Regel-Editor, Foto-Upload
```

## Technik

React 18 · TypeScript · Vite 6 · Dexie (IndexedDB) · React Router.
Keine UI-Bibliothek, das Styling liegt vollständig in `src/index.css`.
