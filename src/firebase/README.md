# Firebase später einhängen

Die App läuft ohne Login auf IndexedDB. Der gesamte Datenzugriff geht über
`src/db/repository.ts` (Interface `Repository`) – ein Firestore-Backend muss nur
dieselben Methoden erfüllen, die UI bleibt unverändert.

## Schritte

1. **Projekt anlegen** auf console.firebase.google.com, Firestore und Authentication
   (E-Mail/Passwort oder Google) aktivieren.
2. **SDK installieren**

   ```bash
   npm install firebase
   ```

3. **Konfiguration** als `.env.local` im Projektordner ablegen:

   ```
   VITE_BACKEND=firebase
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```

4. **`src/firebase/firebaseRepository.ts` anlegen** – ein Objekt vom Typ `Repository`
   mit `kind: 'firebase'`. Empfohlene Collection-Struktur:

   ```
   tenants/{tenantId}/games/{gameId}
   tenants/{tenantId}/items/{itemId}
   tenants/{tenantId}/overrides/{overrideId}
   tenants/{tenantId}/settings/settings
   prices/{gameId}/entries/{entryId}      // gemeinsam für alle Nutzer
   ```

   Fotos gehören in Firebase Storage; im `InventoryItem` wird dann statt der
   Data-URL der Storage-Pfad abgelegt.

5. **Umschalten** in `src/db/index.ts`:

   ```ts
   import { localRepository } from './localRepository';

   export const repo: Repository =
     import.meta.env.VITE_BACKEND === 'firebase'
       ? (await import('../firebase/firebaseRepository')).firebaseRepository
       : localRepository;
   ```

6. **Login-UI**: `onAuthStateChanged` in `src/store.tsx` auswerten und die App erst
   nach erfolgreicher Anmeldung rendern.

## Hinweise

- Preislisten haben pro Spiel schnell > 50 000 Dokumente. Für Firestore lohnt sich
  ein Batch-Import (500 Dokumente pro Batch) über ein Node-Skript oder eine
  Cloud Function statt über den Browser.
- Alternativ bleiben die Preise lokal (IndexedDB) und nur Bestand/Einstellungen
  wandern in Firestore – das spart Kosten und Schreibvorgänge.
- Die bestehenden Daten lassen sich über *Einstellungen → Backup exportieren*
  sichern und nach der Umstellung wieder einlesen.
