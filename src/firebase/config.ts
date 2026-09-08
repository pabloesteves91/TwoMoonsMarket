import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { firebaseConfig } from './env';

/** Initialisiert das Firebase-SDK erst beim ersten Zugriff. */
let app: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;

function getApp(): FirebaseApp {
  if (!app) app = initializeApp(firebaseConfig());
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!authInstance) authInstance = getAuth(getApp());
  return authInstance;
}

export function getDb(): Firestore {
  if (!dbInstance) dbInstance = getFirestore(getApp());
  return dbInstance;
}

/** Übersetzt Firebase-Fehlercodes in verständliche Meldungen. */
export function authErrorMessage(code: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'Die E-Mail-Adresse ist ungültig.';
    case 'auth/user-disabled':
      return 'Dieses Konto wurde deaktiviert.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'E-Mail oder Passwort stimmt nicht.';
    case 'auth/too-many-requests':
      return 'Zu viele Versuche. Bitte später nochmals probieren.';
    case 'auth/network-request-failed':
      return 'Keine Verbindung zu Firebase. Internetverbindung prüfen.';
    case 'auth/missing-password':
      return 'Bitte das Passwort eingeben.';
    default:
      return `Anmeldung fehlgeschlagen (${code}).`;
  }
}
