# Firebase-Betrieb (Firestore + Login)

Die App hat zwei Betriebsarten und schaltet selbst um. Findet sie eine
Firebase-Konfiguration, läuft sie über Firestore und verlangt eine Anmeldung;
sonst bleibt alles lokal in der IndexedDB, ohne Login.

Die Konfiguration kommt aus zwei möglichen Quellen:

1. `.env.local` mit den `VITE_FIREBASE_*`-Variablen – für die lokale Entwicklung.
2. `/__/firebase/init.json` – diese Datei liefert **Firebase Hosting automatisch**
   für das Projekt aus, auf dem die App läuft. Ein Deploy über Firebase Hosting
   braucht deshalb überhaupt keine Konfigurationsdatei.

Die Umschaltung passiert in `src/main.tsx`: nur im Firebase-Modus werden
`firebaseRepository` und `AuthGate` nachgeladen, sonst bleibt das Firebase-SDK
komplett aus dem Start-Bundle.

## Was in der Cloud liegt – und was nicht

| Daten | Ort | Warum |
| --- | --- | --- |
| Bestand, Preisregeln, Spiele, Fotos, Einstellungen | Firestore | müssen auf allen Geräten gleich sein |
| Importierte Cardmarket-Preislisten | IndexedDB, pro Gerät | pro Spiel schnell über 50 000 Datensätze; identisch für alle und jederzeit neu importierbar |

Praktische Folge: **der Preisimport muss auf jedem Gerät einmal laufen.** Der
Bestand dagegen ist sofort überall sichtbar.

## Einrichtung ohne Rechner (nur mit dem Handy)

Projekt: **`twomoonsmarket-c7649`** · spätere Adresse: <https://twomoonsmarket-c7649.web.app>

Der Build läuft in GitHub Actions (`.github/workflows/deploy.yml`), es wird also
weder ein Rechner noch die Firebase-CLI gebraucht. Die folgenden Schritte lassen
sich alle im Handy-Browser erledigen.

### A · In der Firebase-Konsole (console.firebase.google.com)

1. **Firestore anlegen** – *Firestore Database → Datenbank erstellen* →
   Produktionsmodus → Standort `eur3` (Europa).
2. **Anmeldung aktivieren** – *Authentication → Erste Schritte* →
   **E-Mail/Passwort** aktivieren. Dann *Users → Nutzer hinzufügen*: E-Mail und
   Passwort für jede Person, die Zugriff bekommen soll. Die App selbst hat keine
   Registrierung – Konten entstehen nur hier.
3. **Web-App registrieren** – *Projektübersicht → Projekteinstellungen → Meine
   Apps* → Symbol `</>` → Name z.B. „TwoMoons Market" → registrieren.
   Die Konfiguration muss **nirgends abgetippt werden**: Firebase Hosting liefert
   sie unter `/__/firebase/init.json` aus, die App holt sie sich beim Start
   selbst. Der Schritt legt nur die App an, damit es diese Datei gibt.
4. **Schlüssel für den Build erzeugen** – *Projekteinstellungen → Dienstkonten →
   Neuen privaten Schlüssel generieren*. Es lädt eine `.json`-Datei herunter.
   Auf dem iPhone landet sie in *Dateien → Downloads*; dort antippen, der Inhalt
   wird als Text angezeigt → alles markieren und kopieren.

### B · Auf GitHub (github.com, im Browser oder in der GitHub-App)

5. **Schlüssel hinterlegen** – Repository → *Settings → Secrets and variables →
   Actions → New repository secret*:
   * Name: `FIREBASE_SERVICE_ACCOUNT`
   * Secret: der kopierte JSON-Inhalt aus Schritt 4
6. **Deploy starten** – Reiter *Actions* → Workflow *Deploy* → *Run workflow*.
   Der Lauf dauert wenige Minuten und veröffentlicht App, Security Rules und die
   aktuellen Preise.

### C · Danach, in der App

7. <https://twomoonsmarket-c7649.web.app> öffnen und mit dem Konto aus Schritt 2
   anmelden. Es erscheint **„Noch nicht freigeschaltet"** mit der eigenen
   Benutzer-ID – diese kopieren.
8. **Freischalten** – zurück in die Firebase-Konsole, *Firestore Database → Daten*:

   ```
   Sammlung starten:  workspaces
   Dokument-ID:       twomoons          (entspricht VITE_WORKSPACE_ID)
   Feld:              aktiv (boolean) = true     ← nur, damit das Dokument speicherbar ist
   ```

   Im Dokument `twomoons` dann *Sammlung starten*:

   ```
   Sammlungs-ID:  members
   Dokument-ID:   <die kopierte Benutzer-ID>
   Felder:        email (string) = "name@twomoons.ch"
                  role  (string) = "admin"
   ```

   Die Konsole umgeht die Security Rules, deshalb funktioniert dieser erste
   Eintrag ohne bestehende Freischaltung. Weitere Personen werden genauso
   angelegt (`role = "member"`).
9. App neu laden – der Bestand ist da und wird ab jetzt zwischen allen
   angemeldeten Geräten geteilt.

### Für später: Einrichtung mit Rechner

```bash
cp .env.example .env.local   # Werte aus der Firebase-Konsole
npm run deploy:rules         # Security Rules veröffentlichen
npm run deploy               # App veröffentlichen
```

## Preise automatisch aktualisieren

Der Workflow `Deploy` läuft täglich um 05:15 UTC, lädt die Cardmarket-Preislisten
über `scripts/import-prices.mjs` und veröffentlicht sie zusammen mit der App unter
`/prices/`. In der App erscheint dann unter *Preise* der Knopf
**„Preise jetzt aktualisieren"** – ein Tipp, und die Preise landen in der lokalen
Datenbank des Geräts. Kein Datei-Download, kein Rechner.

Wichtig zum Verständnis:

* Der Abruf bei Cardmarket ist **nicht garantiert** – es gibt keine offizielle
  API. Schlägt er fehl, bricht der Deploy nicht ab: die zuletzt veröffentlichten
  Preisdateien bleiben stehen, und im Actions-Protokoll steht der Grund. Dann
  hilft weiterhin der manuelle Upload unter *Preise*.
* Der Knopf muss **pro Gerät** einmal getippt werden, weil die Preislisten lokal
  liegen (siehe Tabelle oben). Der Bestand dagegen ist sofort überall gleich.
* Nutzungsbedingungen von Cardmarket für automatisierte Abrufe bitte prüfen.

## Bestehende Daten übernehmen

Wer die App vorher lokal genutzt hat: vor der Umstellung
*Einstellungen → Backup exportieren*, danach angemeldet
*Backup einlesen* → „Zusammenführen". Der Bestand landet damit in Firestore, die
Preislisten wieder lokal.

## Struktur in Firestore

```
workspaces/{workspaceId}/members/{uid}        { email, role }
workspaces/{workspaceId}/items/{itemId}       Bestandseinträge
workspaces/{workspaceId}/overrides/{id}       Sonderregeln für Sets/Karten
workspaces/{workspaceId}/games/{gameId}       Spiele
workspaces/{workspaceId}/photos/{photoId}     Kartenfotos als Data-URL
workspaces/{workspaceId}/settings/settings    Einstellungen und Preisregeln
```

Mehrere Standorte oder getrennte Bestände lassen sich über `VITE_WORKSPACE_ID`
abbilden – jeder Arbeitsbereich hat eine eigene Mitgliederliste.

## Grenzen der aktuellen Umsetzung

* **Fotos** liegen als Data-URL im Firestore-Dokument (Limit 1 MiB pro Dokument).
  Die App skaliert Bilder vorher auf 900 px und lehnt zu grosse Dateien mit einer
  Meldung ab. Für viele Fotos ist Firebase Storage die bessere Ablage – dafür
  müsste `savePhoto`/`getPhoto` in `firebaseRepository.ts` auf Storage umgestellt
  werden.
* **Kein Live-Update:** die App lädt beim Start und nach jeder Änderung neu, sie
  hört nicht per `onSnapshot` mit. Ändert jemand parallel etwas, wird es erst
  beim nächsten Laden sichtbar.
* **Offline:** ohne Internet ist die Cloud-Variante nicht nutzbar. Firestore
  bietet Offline-Persistenz (`persistentLocalCache`), aktiviert ist sie hier
  nicht.
