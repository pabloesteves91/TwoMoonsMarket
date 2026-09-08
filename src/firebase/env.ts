/**
 * Ermittelt die Firebase-Konfiguration – ohne Import aus dem Firebase-SDK,
 * damit dieses im lokalen Betrieb gar nicht erst geladen wird.
 *
 * Zwei Quellen, in dieser Reihenfolge:
 *  1. `.env.local` (VITE_FIREBASE_*) – für lokale Entwicklung
 *  2. `/__/firebase/init.json` – diese Datei liefert Firebase Hosting
 *     automatisch für das Projekt aus, auf dem die App läuft. Dadurch braucht
 *     ein Deploy über Firebase Hosting überhaupt keine Konfiguration.
 */

export interface FirebaseConfig {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
}

/** Gemeinsamer Arbeitsbereich der Firma – alle Mitarbeitenden teilen sich diesen Bestand. */
export const WORKSPACE_ID = (import.meta.env.VITE_WORKSPACE_ID as string | undefined) ?? 'twomoons';

let resolved: FirebaseConfig | null = null;

/** Die geladene Konfiguration; erst nach `loadFirebaseConfig()` gefüllt. */
export function firebaseConfig(): FirebaseConfig {
  if (!resolved) throw new Error('Firebase-Konfiguration wurde noch nicht geladen.');
  return resolved;
}

function fromEnv(): FirebaseConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID;
  if (!apiKey || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId,
  };
}

async function fromHosting(): Promise<FirebaseConfig | null> {
  try {
    const response = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<FirebaseConfig>;
    if (!data.apiKey || !data.projectId || !data.appId) return null;
    return data as FirebaseConfig;
  } catch {
    // Kein Firebase Hosting (lokaler Server, GitHub Pages, …) oder ungültige Antwort
    return null;
  }
}

/**
 * Lädt die Konfiguration einmalig. Rückgabe `null` bedeutet: lokaler Betrieb
 * ohne Login. `VITE_BACKEND=local` erzwingt das unabhängig von der Konfiguration.
 */
export async function loadFirebaseConfig(): Promise<FirebaseConfig | null> {
  if (resolved) return resolved;
  if ((import.meta.env.VITE_BACKEND as string | undefined) === 'local') return null;

  resolved = fromEnv() ?? (await fromHosting());
  if (!resolved && (import.meta.env.VITE_BACKEND as string | undefined) === 'firebase') {
    console.warn('VITE_BACKEND=firebase gesetzt, aber keine Firebase-Konfiguration gefunden.');
  }
  return resolved;
}
