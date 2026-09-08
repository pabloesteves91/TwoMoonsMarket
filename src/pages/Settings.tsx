import { useRef, useState } from 'react';
import { repo, type BackupPayload } from '../db';
import { loadDemoData } from '../lib/demoData';
import { downloadFile, formatNumber, uid } from '../lib/format';
import { useStore } from '../store';
import { useAuth } from '../firebase/authContext';
import { repositoryKind } from '../db';
import type { Game, Settings } from '../types';

export default function SettingsPage() {
  const { settings, saveSettings, games, saveGame, deleteGame, refresh, items, priceStats } = useStore();
  const { user, member, signOut } = useAuth();
  const cloud = repositoryKind() === 'firebase';
  const [draft, setDraft] = useState<Settings>(settings);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [newGame, setNewGame] = useState<Partial<Game>>({ name: '', short: '', color: '#7a8bd6' });
  const importRef = useRef<HTMLInputElement>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  async function persist() {
    await saveSettings(draft);
    setMessage({ kind: 'ok', text: 'Einstellungen gespeichert.' });
  }

  async function exportBackup() {
    const payload = await repo.exportAll();
    downloadFile(
      `twomoons-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      'application/json',
    );
  }

  async function importBackup(file: File | undefined, mode: 'replace' | 'merge') {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as BackupPayload;
      await repo.importAll(payload, mode);
      await refresh();
      setMessage({ kind: 'ok', text: `Backup "${file.name}" eingelesen.` });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  }

  async function addGame() {
    if (!newGame.name?.trim()) return;
    await saveGame({
      id: uid('game_'),
      name: newGame.name.trim(),
      short: (newGame.short || newGame.name).slice(0, 4).toUpperCase(),
      color: newGame.color ?? '#7a8bd6',
      cardmarketGameId: newGame.cardmarketGameId ? Number(newGame.cardmarketGameId) : undefined,
      cardmarketSlug: newGame.cardmarketSlug?.trim() || undefined,
      sortIndex: games.length,
    });
    setNewGame({ name: '', short: '', color: '#7a8bd6' });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Einstellungen</h1>
          <p>Währung, Spiele, Datensicherung. Alle Daten liegen aktuell lokal im Browser dieses Geräts.</p>
        </div>
        <div className="page-head__actions">
          <button type="button" className="btn btn--primary" disabled={!dirty} onClick={() => void persist()}>
            Speichern
          </button>
        </div>
      </div>

      {message ? (
        <p className={`notice notice--${message.kind === 'ok' ? 'ok' : 'error'}`} style={{ marginBottom: 16 }}>
          {message.text}
        </p>
      ) : null}

      <div className="grid grid--two">
        <div className="card">
          <div className="card__title">Allgemein</div>
          <div className="stack">
            <div>
              <label htmlFor="company">Firma</label>
              <input
                id="company"
                value={draft.companyName}
                onChange={(e) => setDraft({ ...draft, companyName: e.target.value })}
              />
            </div>
            <div className="field-row">
              <div>
                <label htmlFor="currency">Anzeigewährung</label>
                <select
                  id="currency"
                  value={draft.currency}
                  onChange={(e) => setDraft({ ...draft, currency: e.target.value as Settings['currency'] })}
                >
                  <option value="EUR">EUR (wie Cardmarket)</option>
                  <option value="CHF">CHF (umgerechnet)</option>
                </select>
              </div>
              <div>
                <label htmlFor="rate">Kurs 1 EUR = … CHF</label>
                <input
                  id="rate"
                  type="number"
                  step="0.01"
                  min={0}
                  disabled={draft.currency !== 'CHF'}
                  value={draft.eurToChf}
                  onChange={(e) => setDraft({ ...draft, eurToChf: Number(e.target.value) })}
                />
              </div>
            </div>
            <p className="small dim" style={{ margin: 0 }}>
              Preise werden intern immer in EUR gespeichert (Cardmarket-Basis). Der Kurs wird manuell gepflegt.
            </p>

            <div className="field-row">
              <div>
                <label htmlFor="min-delta">Freigabe ab … EUR Abweichung</label>
                <input
                  id="min-delta"
                  type="number"
                  step="0.05"
                  min={0}
                  value={draft.approvalMinDelta}
                  onChange={(e) => setDraft({ ...draft, approvalMinDelta: Number(e.target.value) })}
                />
              </div>
              <div>
                <label htmlFor="min-percent">… und ab … % Abweichung</label>
                <input
                  id="min-percent"
                  type="number"
                  step="1"
                  min={0}
                  value={draft.approvalMinPercent}
                  onChange={(e) => setDraft({ ...draft, approvalMinPercent: Number(e.target.value) })}
                />
              </div>
            </div>
            <p className="small dim" style={{ margin: 0 }}>
              Beide Grenzen müssen erreicht sein, damit eine Karte in der Preisfreigabe erscheint. So schlägt
              weder ein paar Rappen auf einer teuren Karte noch ein Prozentsprung auf einer Zehn-Rappen-Karte
              unnötig Alarm.
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card__title">Datenbestand</div>
          <dl className="kv">
            <dt>Bestandseinträge</dt>
            <dd>{formatNumber(items.length)}</dd>
            <dt>Karten gesamt</dt>
            <dd>{formatNumber(items.reduce((sum, item) => sum + item.quantity, 0))}</dd>
            {priceStats.map((stat) => (
              <div key={stat.gameId} style={{ display: 'contents' }}>
                <dt>Preise {games.find((g) => g.id === stat.gameId)?.short ?? stat.gameId}</dt>
                <dd>{formatNumber(stat.count)}</dd>
              </div>
            ))}
          </dl>
          <p className="small dim" style={{ marginTop: 12, marginBottom: 0 }}>
            Das Backup enthält Bestand, Regeln, Fotos und Einstellungen. Die Preislisten bleiben aussen vor –
            sie sind unter <em>Preise</em> mit einem Tipp wieder da.
          </p>
          <div className="row" style={{ marginTop: 14 }}>
            <button type="button" className="btn btn--sm" onClick={() => void exportBackup()}>
              Backup exportieren
            </button>
            <button type="button" className="btn btn--sm" onClick={() => importRef.current?.click()}>
              Backup einlesen
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                const mode = confirm('Bestehende Daten ersetzen? (Abbrechen = zusammenführen)')
                  ? 'replace'
                  : 'merge';
                void importBackup(file, mode);
              }}
            />
            <button
              type="button"
              className="btn btn--sm"
              onClick={() =>
                void loadDemoData()
                  .then(refresh)
                  .then(() => setMessage({ kind: 'ok', text: 'Demo-Daten geladen.' }))
              }
            >
              Demo-Daten laden
            </button>
            <button
              type="button"
              className="btn btn--sm btn--danger"
              onClick={() => {
                if (confirm('Wirklich alle Daten löschen? Das lässt sich nicht rückgängig machen.')) {
                  void repo
                    .resetAll()
                    .then(refresh)
                    .then(() => setMessage({ kind: 'ok', text: 'Alle Daten gelöscht.' }));
                }
              }}
            >
              Alles zurücksetzen
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__title">Spiele</div>
        <p className="card__hint">
          Weitere TCGs lassen sich jederzeit ergänzen. Die Cardmarket-ID braucht nur das Import-Skript
          (Magic = 1, Yu-Gi-Oh! = 3, Pokémon = 6).
        </p>
        <ul className="list-reset divide">
          {games.map((game) => (
            <li key={game.id} className="row row--between">
              <span>
                <span className="badge badge--game" style={{ background: game.color }}>
                  {game.short}
                </span>{' '}
                <span className="cell-main">{game.name}</span>
                <br />
                <span className="cell-sub">
                  Cardmarket-ID {game.cardmarketGameId ?? '–'} · Pfad {game.cardmarketSlug ?? '–'}
                </span>
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  if (
                    confirm(
                      `${game.name} löschen? Bestand und Preise dieses Spiels werden ebenfalls entfernt.`,
                    )
                  )
                    void deleteGame(game.id);
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>

        <div className="field-row" style={{ marginTop: 16 }}>
          <div>
            <label htmlFor="ng-name">Name</label>
            <input
              id="ng-name"
              placeholder="z.B. Yu-Gi-Oh!"
              value={newGame.name ?? ''}
              onChange={(e) => setNewGame({ ...newGame, name: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="ng-short">Kürzel</label>
            <input
              id="ng-short"
              placeholder="YGO"
              value={newGame.short ?? ''}
              onChange={(e) => setNewGame({ ...newGame, short: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="ng-cmid">Cardmarket-ID</label>
            <input
              id="ng-cmid"
              type="number"
              placeholder="3"
              value={newGame.cardmarketGameId ?? ''}
              onChange={(e) => setNewGame({ ...newGame, cardmarketGameId: Number(e.target.value) })}
            />
          </div>
          <div>
            <label htmlFor="ng-slug">Cardmarket-Pfad</label>
            <input
              id="ng-slug"
              placeholder="YuGiOh"
              value={newGame.cardmarketSlug ?? ''}
              onChange={(e) => setNewGame({ ...newGame, cardmarketSlug: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="ng-color">Farbe</label>
            <input
              id="ng-color"
              type="color"
              value={newGame.color ?? '#7a8bd6'}
              onChange={(e) => setNewGame({ ...newGame, color: e.target.value })}
            />
          </div>
        </div>
        <button type="button" className="btn btn--sm" style={{ marginTop: 12 }} onClick={() => void addGame()}>
          + Spiel hinzufügen
        </button>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__title">
          Konto &amp; Speicherort
          <span className={`badge badge--${cloud ? 'ok' : 'warn'}`}>{cloud ? 'Cloud (Firestore)' : 'Nur dieses Gerät'}</span>
        </div>
        {cloud ? (
          <>
            <dl className="kv">
              <dt>Angemeldet als</dt>
              <dd>{user?.email ?? '–'}</dd>
              <dt>Rolle</dt>
              <dd>{member?.role === 'admin' ? 'Administration' : 'Team'}</dd>
            </dl>
            <p className="card__hint" style={{ marginTop: 12 }}>
              Bestand, Regeln und Einstellungen werden mit allen angemeldeten Geräten geteilt. Die
              importierten Preislisten bleiben aus Kostengründen lokal auf jedem Gerät – der Import muss
              also pro Gerät einmal laufen.
            </p>
            <button type="button" className="btn btn--sm" onClick={() => void signOut()}>
              Abmelden
            </button>
          </>
        ) : (
          <p className="card__hint" style={{ marginBottom: 0 }}>
            Die App läuft ohne Login; alle Daten liegen nur in diesem Browser. Für den gemeinsamen Bestand
            über mehrere Geräte die Firebase-Zugangsdaten in <span className="mono">.env.local</span>{' '}
            hinterlegen – die Schritte stehen in <span className="mono">src/firebase/README.md</span>. Bis
            dahin: Backups regelmässig exportieren.
          </p>
        )}
      </div>
    </>
  );
}
