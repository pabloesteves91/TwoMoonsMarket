import { createContext, useContext } from 'react';

/**
 * Auth-Kontext ohne Firebase-Import: so ziehen App und Einstellungen nicht das
 * gesamte Firebase-SDK in das Start-Bundle, wenn die App lokal läuft.
 */
export interface AuthUser {
  uid: string;
  email: string | null;
}

/**
 * Rollen im Arbeitsbereich.
 *
 * - `admin`  darf alles, auch die Mitgliederliste ändern
 * - `member` darf alles ausser der Mitgliederliste
 * - `store`  darf nur verkaufen: Preis bestätigen oder anpassen, sonst nichts.
 *            Gedacht für Aushilfen am Tresen.
 */
export type Role = 'admin' | 'member' | 'store';

export interface Member {
  email?: string;
  role?: Role;
  name?: string;
}

/**
 * Konto, das nur verkaufen darf.
 *
 * Ohne Anmeldung (lokaler Modus zum Ausprobieren) gilt das nicht – dort gibt es
 * keine Rollen und niemanden, vor dem etwas zu verbergen wäre.
 */
export function isStoreOnly(member: Member | null): boolean {
  return member?.role === 'store';
}

export interface AuthValue {
  /** null im lokalen Modus (kein Login nötig) */
  user: AuthUser | null;
  member: Member | null;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthValue>({
  user: null,
  member: null,
  signOut: async () => {},
});

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
