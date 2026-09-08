/**
 * Firebase-Konfiguration aus den VITE_-Umgebungsvariablen (.env.local).
 *
 * Dieses Modul importiert bewusst nichts aus dem Firebase-SDK: nur so bleibt das
 * SDK aus dem Start-Bundle, solange die App lokal ohne Login läuft.
 */
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** Gemeinsamer Arbeitsbereich der Firma – alle Mitarbeitenden teilen sich diesen Bestand. */
export const WORKSPACE_ID = (import.meta.env.VITE_WORKSPACE_ID as string | undefined) ?? 'twomoons';

/**
 * true, wenn die App gegen Firebase laufen soll. `VITE_BACKEND` kann die
 * Automatik überschreiben (`local` erzwingt den Offline-Modus).
 */
export function isFirebaseEnabled(): boolean {
  const backend = import.meta.env.VITE_BACKEND as string | undefined;
  if (backend === 'local') return false;
  const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
  if (backend === 'firebase' && !configured) {
    console.warn('VITE_BACKEND=firebase gesetzt, aber die Firebase-Konfiguration ist unvollständig.');
    return false;
  }
  return configured;
}
