import { createContext, useContext } from 'react';

/**
 * Auth-Kontext ohne Firebase-Import: so ziehen App und Einstellungen nicht das
 * gesamte Firebase-SDK in das Start-Bundle, wenn die App lokal läuft.
 */
export interface AuthUser {
  uid: string;
  email: string | null;
}

export interface Member {
  email?: string;
  role?: 'admin' | 'member';
  name?: string;
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
