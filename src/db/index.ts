import { localRepository } from './localRepository';
import type { Repository } from './repository';

/**
 * Aktives Backend. Standard ist die lokale IndexedDB; ist Firebase konfiguriert,
 * wird beim Start in `src/main.tsx` das Firestore-Repository eingehängt.
 */
let active: Repository = localRepository;

export function setRepository(next: Repository): void {
  active = next;
}

export function repositoryKind(): Repository['kind'] {
  return active.kind;
}

/**
 * Stabiler Zugriffspunkt für die gesamte App: die Weiterleitung erlaubt es,
 * das Backend beim Start auszutauschen, ohne dass Module neu importiert werden.
 */
export const repo: Repository = new Proxy({} as Repository, {
  get(_target, property) {
    const value = active[property as keyof Repository];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(active) : value;
  },
});

export type { Repository, BackupPayload, PriceStats } from './repository';
export { DEFAULT_GAMES } from './localRepository';
