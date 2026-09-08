# Firebase-Betrieb (Firestore + Login)

Die App hat zwei Betriebsarten. Ohne `.env.local` läuft sie lokal ohne Login,
alle Daten bleiben in der IndexedDB des jeweiligen Browsers. Sind die
Firebase-Variablen gesetzt, schaltet sie automatisch auf Firestore um und
verlangt eine Anmeldung.

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

## Einrichtung

### 1. Firestore anlegen

Firebase-Konsole → *Firestore Database* → *Datenbank erstellen* → Produktionsmodus,
Standort `eur3` (Europa).

### 2. Anmeldung aktivieren

*Authentication* → *Sign-in method* → **E-Mail/Passwort** aktivieren.
Danach unter *Users* für jede Mitarbeiterin und jeden Mitarbeiter ein Konto
anlegen. Die App selbst hat bewusst keine Registrierung – Konten entstehen nur
in der Konsole.

### 3. Security Rules veröffentlichen

```bash
npm run deploy:rules
```

Die Regeln stehen in `firestore.rules`. Kern: Zugriff hat nur, wer unter
`workspaces/<workspace>/members/<uid>` eingetragen ist. Das ist wichtig, weil
sich mit aktivierter E-Mail-Anmeldung technisch jede Person ein Konto anlegen
könnte – ohne Mitglieds-Eintrag sieht ein solches Konto aber nichts ausser dem
Hinweis „Noch nicht freigeschaltet".

### 4. Erste Person freischalten

In der Konsole → *Authentication → Users* die UID kopieren, dann in *Firestore*
anlegen:

```
Sammlung:   workspaces
Dokument:   twomoons                     (entspricht VITE_WORKSPACE_ID)
Sammlung:   members
Dokument:   <UID>
Felder:     email = "name@twomoons.ch"   (String)
            role  = "admin"              (String)
```

Die Konsole umgeht die Security Rules, deshalb funktioniert dieser erste Eintrag
auch ohne bestehende Freischaltung. Alle weiteren Mitglieder lassen sich danach
genauso anlegen (`role = "member"`). Wer sich anmeldet, ohne freigeschaltet zu
sein, bekommt seine Benutzer-ID zum Kopieren angezeigt.

### 5. Konfiguration eintragen

`.env.example` nach `.env.local` kopieren und die Werte aus
*Projekteinstellungen → Allgemein → Meine Apps → Web-App → SDK-Konfiguration*
einsetzen. Ist dort noch keine Web-App registriert, mit dem `</>`-Symbol eine
anlegen.

```bash
cp .env.example .env.local
npm run dev        # ab jetzt mit Login
```

`.env.local` ist in `.gitignore` und gehört nicht ins Repository. Die Werte sind
keine Geheimnisse (sie stehen in jedem ausgelieferten Bundle) – die Absicherung
leisten die Security Rules, nicht der API-Key.

### 6. Veröffentlichen

```bash
npm run deploy
```

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
