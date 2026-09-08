import { localRepository } from './localRepository';
import type { Repository } from './repository';

/**
 * Aktives Backend. Sobald Firebase eingerichtet ist, wird hier je nach
 * Umgebungsvariable (VITE_BACKEND=firebase) das Firestore-Repository geladen.
 * Siehe src/firebase/README.md.
 */
export const repo: Repository = localRepository;

export type { Repository, BackupPayload } from './repository';
export { DEFAULT_GAMES } from './localRepository';
