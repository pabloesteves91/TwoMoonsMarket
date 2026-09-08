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

## Auf dem Handy nutzen

### Schnell: im gleichen WLAN

`npm run dev` gibt neben der lokalen auch eine `Network:`-Adresse aus
(z.B. `http://192.168.1.42:5173/`). Diese am Handy im selben WLAN öffnen – kein
Deploy nötig, solange der Rechner läuft. Dasselbe funktioniert mit
`npm run preview` für den Produktions-Build.

### Dauerhaft: Firebase Hosting

Veröffentlicht wird über GitHub Actions – ein Rechner ist dafür nicht nötig.
Der Workflow `Deploy` (`.github/workflows/deploy.yml`) baut die App, holt die
aktuellen Preise und veröffentlicht beides; er läuft bei jedem Push, täglich und
auf Knopfdruck unter *Actions → Deploy → Run workflow*. Einzige Voraussetzung ist
das Repository-Secret `FIREBASE_SERVICE_ACCOUNT` – die Einrichtung steht in
[`src/firebase/README.md`](src/firebase/README.md).

Adresse danach: `https://<projekt-id>.web.app`. Eine eigene Domain lässt sich in
der Firebase-Konsole unter *Hosting → Custom domain* verbinden.

Am Rechner geht es weiterhin direkt:

```bash
npx firebase-tools login && npm run deploy
```

### Als App auf dem Homescreen

Die Seite bringt ein Web-App-Manifest und Icons mit. Über *Teilen → Zum
Home-Bildschirm* (iOS) bzw. *Menü → App installieren* (Android) startet sie ohne
Browser-Leiste im Vollbild.

**Zu den Daten:** Im lokalen Modus hat jedes Gerät seinen eigenen Bestand – Handy
und Büro-Rechner sind getrennt, Übertrag über *Einstellungen → Backup
exportieren/einlesen*. Mit eingerichtetem Firebase (siehe unten) teilen sich alle
angemeldeten Geräte denselben Bestand.

## Funktionen

| Bereich | Inhalt |
| --- | --- |
| **Dashboard** | Kartenanzahl, Verkaufswert, Einkaufswert, Marge, wertvollste Positionen, Stand der Preisliste |
| **Bestand** | Zustand (MT–PO) mit Preiswirkung, Sprache, Foil, Menge, Lagerort, Einkaufspreis, Fixpreis, Notiz, Foto; Serienerfassung, Suche, Filter, Sortierung; CSV-Export |
| **Freigabe** | Vergleich Kärtchenpreis ↔ berechneter Preis, Änderungen einzeln bestätigen, Liste zum Umetikettieren als CSV |
| **Verkäufe** | Verkauf buchen (Menge, Preis, Datum, Kanal), Umsatz/Gewinn/Marge, Umsatzverlauf je Woche, Meistverkauft, CSV-Export, Storno |
| **Preise** | Automatischer Abgleich mit der veröffentlichten Liste, Import per Drag & Drop (JSON/CSV), Suche in der Preisliste mit berechnetem Verkaufspreis |
| **Regeln** | Getrennte Preisregeln für Foil und Non-Foil, Sonderregeln pro Set und pro Karte, optionale Zustandsfaktoren |
| **Einstellungen** | Währung EUR/CHF, Spiele verwalten, Backup exportieren/einlesen, Demo-Daten, Zurücksetzen |

### Verkäufe

Im Bestand bucht **„Verkauft"** einen Verkauf: Menge, Preis pro Stück (vorbelegt
mit dem Kärtchenpreis), Datum und Kanal. Die Menge wird aus dem Bestand
ausgebucht, der Verkauf bleibt mit Name, Set und Zustand erhalten – auch wenn der
Bestandseintrag später verschwindet. Ein Storno bucht die Karten zurück.

Unter *Verkäufe* stehen Umsatz, Gewinn und Marge für den gewählten Zeitraum, der
Umsatzverlauf je Woche, die meistverkauften Karten und die Aufteilung nach Spiel.
Der Gewinn wird nur aus Verkäufen mit erfasstem Einkaufspreis gerechnet.

### Preise am Kärtchen: Freigabe statt Automatik

Im Laden steht der Preis auf dem Kärtchen und ändert sich erst, wenn ihn jemand
neu schreibt. Die App bildet das ab: jeder Bestandseintrag merkt sich den
**zuletzt freigegebenen Preis**, und unter *Freigabe* stehen nur die Karten, bei
denen der berechnete Preis inzwischen abweicht – mit alt → neu, Differenz in
Prozent und einer CSV-Liste zum Mitnehmen an die Vitrine. Erst das Bestätigen
setzt den neuen Kärtchenpreis.

Damit nicht jede Kleinigkeit auf der Liste landet, müssen **beide** Schwellen aus
den Einstellungen erreicht sein (Standard 0.20 EUR **und** 5 %): ein paar Rappen
auf einer teuren Karte sind ebenso wenig ein Grund zum Umetikettieren wie ein
Prozentsprung auf einer Zehn-Rappen-Karte.

Frisch erfasste Karten bekommen den aktuell berechneten Preis gleich als
Kärtchenpreis – sie landen also nicht sofort auf der Freigabeliste.

### Grössere Mengen erfassen

Im Erfassungsdialog speichert **„+ Nächste"** und hält die Maske offen: Spiel,
Set, Zustand, Sprache, Foil und Lagerort bleiben stehen, der Name ist leer und
fokussiert. Beim Durcharbeiten einer Kiste ändert sich meist nur der Name.

### Warum die Basis beim Zustand gleich bleibt

Cardmarket führt je Karte **einen** Marktpreis, nicht einen je Zustand – die
Spalten sind Trend, Durchschnitt und Tiefstpreis, keine davon ist zustandsbezogen.
Die Basis ist also der Marktpreis für Near-Mint-Ware und ändert sich nicht, wenn
ein anderer Zustand gewählt wird; der Zustand wirkt als Faktor darauf. Echte
Preise je Zustand gäbe es nur aus den laufenden Angeboten, und die stehen nur
über die Cardmarket-API mit Verkäufer-Konto zur Verfügung.

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

### Variante A – vollautomatisch (empfohlen)

Der GitHub-Actions-Workflow `Deploy` läuft jeden Montagmorgen, lädt Preisliste und
Produktkatalog, führt beide zu einer schlanken Datei je Spiel zusammen und
veröffentlicht sie zusammen mit der App unter `/prices/`. In der App erscheint
dann unter **Preise** der Knopf **„Preise jetzt aktualisieren"** – ein Tipp
genügt, auch auf dem Handy. Kein Datei-Download, kein Rechner.

Die App holt neue Preise **von selbst**: Beim Start prüft sie den Stand der
veröffentlichten Liste und übernimmt sie, wenn er sich geändert hat. Während
dessen ist die App benutzbar, ein Hinweis zeigt den Fortschritt. Der Knopf unter
*Preise* bleibt für den Fall, dass es sofort sein soll.

Die Liste liegt im Web; jedes Gerät hält davon nur eine Kopie zum schnellen
Nachschlagen – bei knapp 200 000 Karten wären Einzelabfragen über das Netz beim
Tippen zu langsam. Über die Leitung gehen dabei rund 3 MB, und nur dann, wenn
tatsächlich ein neuer Stand veröffentlicht wurde. Schlägt der Abruf bei Cardmarket fehl, bleiben die zuletzt
veröffentlichten Dateien stehen und der Grund steht im Actions-Protokoll.

### Variante B – am Rechner

```bash
npm run import:prices                 # Magic (1) + Pokémon (6)
npm run import:prices -- --games 1,6,3 --catalog --index --out ./data
```

Das Skript legt die Dateien in `data/` ab. Diese anschliessend in der App unter
**Preise** hochladen (Drag & Drop). Mit `--index` entsteht zusätzlich ein
`index.json`, wie es der automatische Abruf verwendet. Bitte vorab die
Nutzungsbedingungen von Cardmarket für automatisierte Abrufe prüfen.

### Set-Kürzel und Sammlernummer für Magic (Scryfall)

Der Cardmarket-Katalog führt die Edition nur als Nummer und kennt keine
Sammlernummer. [Scryfall](https://scryfall.com) ist frei zugänglich, braucht
keine Anmeldung und führt zu jeder Ausgabe die Cardmarket-Produktnummer mit –
darüber verbindet `scripts/enrich-scryfall.mjs` beides und ergänzt Set-Kürzel
(„TLA"), Sammlernummer und Seltenheit.

Die Sammeldatei ist mehrere hundert Megabyte gross und wird deshalb zeilenweise
verarbeitet. Schlägt der Schritt fehl, fehlen nur diese Angaben; alles andere
läuft weiter. Datenquelle: Scryfall, frei nutzbar mit Namensnennung.

### Set-Code und Nummer für Pokémon (pokemontcg.io)

Für Pokémon gibt es keine freie Quelle mit Cardmarket-Produktnummern. Die
Zuordnung läuft deshalb über die Edition: der Cardmarket-Katalog gruppiert die
Karten nach `idExpansion`, ohne deren Namen zu kennen. `scripts/enrich-pokemon.mjs`
prüft für jede Gruppe, in welchem bekannten Set die meisten ihrer Kartennamen
vorkommen. Stimmen mindestens fünf Karten und 30 Prozent überein, gilt die
Edition als erkannt und ihre Karten bekommen Set-Code (PTCGO, z.B. „ASR"),
Sammlernummer und Seltenheit.

Ein Abgleich rein über den Kartennamen wäre unbrauchbar – derselbe Name kommt in
vielen Sets vor. Über die Gruppe ist er eindeutig. Editionen, die sich nicht
sicher zuordnen lassen, bleiben ohne Set; dort zeigt die App weiterhin die
Produktnummer.

Datenquelle: pokemontcg.io, frei und ohne Anmeldung nutzbar.

### Editionsnamen über die Cardmarket-API (nur mit Verkäufer-Konto)

Der Produktkatalog führt die Edition nur als Nummer (`idExpansion`). Die Zuordnung
zu Abkürzung („TLA") und Namen liefert die
[Cardmarket-API](https://apiv2.cardmarket.com/ws/documentation) mit **einer
Abfrage je Spiel** – für Magic und Pokémon gleichermassen.

Einrichtung:

Der App-Zugang ist an den Verkäufer-Status gekoppelt; ohne ihn greift der
Scryfall-Weg oben. Falls der Zugang später besteht:

1. Im Cardmarket-Konto unter *Account → Einstellungen → App-Zugang* eine App
   anlegen. Cardmarket zeigt danach vier Werte an: App-Token, App-Secret,
   Access-Token und Access-Secret.
2. Diese vier Werte auf GitHub als Repository-Secrets hinterlegen
   (*Settings → Secrets and variables → Actions*):
   `CM_APP_TOKEN`, `CM_APP_SECRET`, `CM_ACCESS_TOKEN`, `CM_ACCESS_SECRET`.

Mehr ist nicht nötig – der wöchentliche Lauf holt die Editionen dann automatisch.
Fehlen die Werte, läuft alles wie bisher, nur ohne Set-Namen; die App zeigt
stattdessen die Cardmarket-Produktnummer.

Die Signatur (OAuth 1.0a, HMAC-SHA1) steckt in `scripts/cardmarket-api.mjs`.

### Variante C – manuell

Preisliste auf <https://www.cardmarket.com/en/Magic/Data/Price-Guide> herunterladen
und in der App unter **Preise** hochladen.

### Unterstützte Dateiformate

* **Price-Guide-JSON** (`{ "priceGuides": [{ "idProduct": …, "trend": … }] }`) –
  enthält nur Produkt-IDs; Kartennamen kommen aus dem Produkt-Katalog, der sich
  einfach zusätzlich hochladen lässt (die Datensätze werden über die Produkt-ID
  zusammengeführt).
* **Produkt-Katalog** (JSON oder CSV) mit `idProduct`, `name`, `expansion`.
* **Editionsliste** – der Produktkatalog führt die Edition nur als Nummer
  (`idExpansion`), nicht als Namen. Liegt die Editionsliste vor, ergänzt der
  Build daraus den Set-Namen; solange sie fehlt, zeigt die App statt des Sets die
  Cardmarket-Produktnummer, damit gleichnamige Karten unterscheidbar bleiben.
  `scripts/probe-cardmarket.mjs` sucht die Datei und protokolliert das Ergebnis
  bei jedem Lauf.
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

## Datenhaltung: lokal oder Cloud

Die App hat zwei Betriebsarten, sie schaltet automatisch um:

| | **Lokal** (ohne `.env.local`) | **Cloud** (mit Firebase-Konfiguration) |
| --- | --- | --- |
| Login | keiner | E-Mail/Passwort |
| Bestand, Regeln, Fotos | IndexedDB, pro Gerät | Firestore, für alle gleich |
| Preislisten | IndexedDB | IndexedDB (bleibt pro Gerät) |
| Einsatz | Testen, Einzelplatz | Team, Handy + PC gemeinsam |

Im Cloud-Modus sehen alle angemeldeten Geräte denselben Bestand. Die importierten
Preislisten bleiben bewusst lokal – pro Spiel sind das schnell über 50 000
Datensätze, die für alle identisch und jederzeit neu importierbar sind. Praktische
Folge: **der Preisimport läuft einmal pro Gerät**, der Bestand ist sofort überall.

Einrichtung (Firestore anlegen, Konten erstellen, Mitglieder freischalten):
[`src/firebase/README.md`](src/firebase/README.md) – dort Schritt für Schritt,
komplett im Handy-Browser erledigbar. Auf Firebase Hosting holt sich die App ihre
Konfiguration selbst (`/__/firebase/init.json`), es muss nichts abgetippt werden.

Zugriff hat nur, wer in Firestore unter `workspaces/<id>/members/<uid>`
eingetragen ist – ein blosses Konto genügt nicht. Wer sich ohne Freischaltung
anmeldet, sieht seine Benutzer-ID zum Weitergeben an die Administration.

Im lokalen Modus gilt weiterhin: die Daten liegen nur in diesem einen Browser,
also regelmässig *Einstellungen → Backup exportieren*. Der Umzug in die Cloud
läuft über *Backup exportieren* → anmelden → *Backup einlesen*.

Die Suche findet Karten über den Wortanfang: „bolt" führt zu „Lightning Bolt",
„light bol" ebenfalls. Eine Suche nach Wortteilen in der Mitte („ightn") gibt es
nicht – bei knapp 200 000 Karten wäre das auf dem Handy zu langsam.

Das Backup enthält Bestand, Regeln, Fotos und Einstellungen, aber **keine
Preislisten** – die sind mit einem Tipp neu abgerufen und würden die Datei nur
um zweistellige Megabyte aufblähen.

Technisch liegt der gesamte Datenzugriff hinter dem Interface `Repository`
(`src/db/repository.ts`); `localRepository` und `firebaseRepository` erfüllen es
gleichermassen, die Oberfläche kennt den Unterschied nicht.

## Projektstruktur

```
firebase.json               Hosting- und Firestore-Konfiguration
firestore.rules             Security Rules (Zugriff nur für freigeschaltete Mitglieder)
.github/workflows/          Build, Preisabruf und Deploy über GitHub Actions
public/                     App-Icons und Web-App-Manifest
scripts/import-prices.mjs   Download der Cardmarket-Preislisten
scripts/build-price-bundle.mjs  Katalog + Preisliste zu einer schlanken Datei verdichten
src/lib/pricing.ts          Preisregeln, Matching, Rundung
src/lib/cardmarket.ts       Import-Parser (JSON/CSV, Spaltenerkennung)
src/lib/cloudPrices.ts      Preisabruf aus dem Web (/prices/index.json)
src/lib/exporters.ts        CSV-Export-Formate
src/db/                     Repository-Interface + IndexedDB-Implementierung
                            (Schema v2 ist auf ~200 000 Preis-Datensätze ausgelegt)
src/firebase/               Firestore-Repository, Login-Gate, Konfiguration
src/pages/                  Dashboard, Bestand, Preise, Regeln, Einstellungen
src/components/             Modal, Bestandsformular, Regel-Editor, Foto-Upload
```

## Technik

React 18 · TypeScript · Vite 6 · Dexie (IndexedDB) · React Router · Firebase (optional).
Keine UI-Bibliothek, das Styling liegt vollständig in `src/index.css`.
