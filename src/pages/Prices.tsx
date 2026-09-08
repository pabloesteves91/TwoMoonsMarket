import { useEffect, useRef, useState } from 'react';
import { repo } from '../db';
import { parsePriceFile, type ImportResult } from '../lib/cardmarket';
import { formatDate, formatMoney, formatNumber } from '../lib/format';
import {
  fetchPriceManifest,
  importPricesFromCloud,
  type CloudImportProgress,
  type PriceManifest,
} from '../lib/cloudPrices';
import { buildPriceContext, calculatePrice, readBasisWithFallback } from '../lib/pricing';
import { useStore } from '../store';
import type { PriceEntry } from '../types';

export default function Prices() {
  const { games, settings, priceStats, refresh, overrides } = useStore();
  const [gameId, setGameId] = useState(games[0]?.id ?? 'mtg');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<{ file: string; imported: number; info: ImportResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<PriceManifest | null>(null);
  const [cloudBusy, setCloudBusy] = useState<CloudImportProgress | null>(null);
  const [cloudResult, setCloudResult] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PriceEntry[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<number>();

  // Liegen neben der App Preisdateien aus dem Wartungslauf?
  useEffect(() => {
    void fetchPriceManifest().then(setManifest);
  }, []);

  useEffect(() => {
    window.clearTimeout(searchTimer.current);
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      void repo.searchPriceEntries(query, gameId, 40).then(setHits);
    }, 220);
    return () => window.clearTimeout(searchTimer.current);
  }, [query, gameId]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      for (const file of Array.from(files)) {
        const text = await file.text();
        const info = parsePriceFile(text, gameId, file.name);
        if (info.entries.length === 0) throw new Error(`${file.name}: keine verwertbaren Zeilen gefunden.`);
        const imported = await repo.upsertPriceEntries(info.entries);
        setResult({ file: file.name, imported, info });
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function loadFromCloud() {
    if (!manifest) return;
    setError(null);
    setResult(null);
    setCloudResult(null);
    try {
      const outcome = await importPricesFromCloud(manifest, games, setCloudBusy);
      await refresh();
      const skipped = outcome.skippedFiles.length
        ? ` ${outcome.skippedFiles.length} Datei(en) übersprungen.`
        : '';
      setCloudResult(
        `${formatNumber(outcome.imported)} Preise aus ${outcome.files} Datei(en) übernommen (Stand ${formatDate(
          Date.parse(outcome.createdAt),
        )}).${skipped}`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCloudBusy(null);
    }
  }

  async function clearGame() {
    const game = games.find((g) => g.id === gameId);
    if (!confirm(`Alle Preisdaten für ${game?.name ?? gameId} löschen?`)) return;
    await repo.clearPriceEntries(gameId);
    await refresh();
    setHits([]);
  }

  const ctx = buildPriceContext(settings, hits, overrides);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Preise</h1>
          <p>
            Cardmarket-Preisliste importieren und durchsuchen. Unterstützt werden die Price-Guide-JSON-Dateien,
            der Produkt-Katalog sowie beliebige CSV-Dateien mit Namens- und Preisspalten.
          </p>
        </div>
        <div className="page-head__actions">
          <select value={gameId} onChange={(e) => setGameId(e.target.value)} aria-label="Spiel für den Import">
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid--stats" style={{ marginBottom: 18 }}>
        {games.map((game) => {
          const stat = priceStats.find((s) => s.gameId === game.id);
          return (
            <div className="stat" key={game.id}>
              <div className="stat__label">{game.name}</div>
              <div className="stat__value">{formatNumber(stat?.count ?? 0)}</div>
              <div className="stat__hint">Stand: {formatDate(stat?.updatedAt ?? null)}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid--two">
        <div className="stack">
          {manifest ? (
            <div className="card">
              <div className="card__title">
                Automatischer Preisabruf
                <span className="badge badge--ok">bereit</span>
              </div>
              <p className="card__hint">
                Stand der veröffentlichten Liste: {formatDate(Date.parse(manifest.createdAt))}. Die App holt
                neue Preise beim Start von selbst – dieser Knopf ist nur nötig, wenn es sofort sein soll.
              </p>
              <button
                type="button"
                className="btn btn--primary btn--block"
                disabled={Boolean(cloudBusy)}
                onClick={() => void loadFromCloud()}
              >
                {cloudBusy
                  ? `${cloudBusy.phase === 'download' ? 'Lädt' : cloudBusy.phase === 'parse' ? 'Liest' : 'Speichert'} ${
                      cloudBusy.index + 1
                    }/${cloudBusy.total} …`
                  : 'Preise jetzt aktualisieren'}
              </button>
              {cloudResult ? (
                <p className="notice notice--ok" style={{ marginTop: 12, marginBottom: 0 }}>
                  {cloudResult}
                </p>
              ) : null}
            </div>
          ) : null}

          <div
            className={`dropzone${dragging ? ' is-over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void handleFiles(e.dataTransfer.files);
            }}
          >
            <div style={{ fontSize: 26, marginBottom: 8 }}>⤓</div>
            <strong>{busy ? 'Import läuft …' : 'Preisdatei hierher ziehen'}</strong>
            <p className="small" style={{ margin: '6px 0 0' }}>
              JSON oder CSV · Import läuft auf <em>{games.find((g) => g.id === gameId)?.name}</em>
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.csv,.txt,application/json,text/csv"
              multiple
              hidden
              onChange={(e) => void handleFiles(e.target.files)}
            />
          </div>

          {error ? <p className="notice notice--error">{error}</p> : null}

          {result ? (
            <div className="notice notice--ok">
              <strong>{result.file}</strong> importiert: {formatNumber(result.imported)} Datensätze
              {result.info.skipped > 0 ? `, ${formatNumber(result.info.skipped)} Zeilen übersprungen` : ''}.
              <br />
              Format: {result.info.format}
              {result.info.mapping ? (
                <>
                  <br />
                  <span className="mono">
                    {Object.entries(result.info.mapping)
                      .map(([field, header]) => `${field} ← "${header}"`)
                      .join(', ')}
                  </span>
                </>
              ) : null}
              {result.info.warnings.map((warning) => (
                <div key={warning} className="small" style={{ marginTop: 6 }}>
                  {warning}
                </div>
              ))}
            </div>
          ) : null}

          <div className="card">
            <div className="card__title">Woher bekomme ich die Datei?</div>
            <ol className="small muted" style={{ paddingLeft: 18, margin: 0, display: 'grid', gap: 6 }}>
              <li>
                Normalfall: Der Wartungslauf holt die Preise montags und stellt sie neben der App bereit. Die
                App übernimmt sie beim nächsten Start automatisch, auf jedem Gerät.
              </li>
              <li>
                Am Rechner: <span className="mono">npm run import:prices</span> ausführen. Das Skript legt die
                Dateien unter <span className="mono">data/</span> ab – anschliessend hier hochladen.
              </li>
              <li>
                Manuell: Preisliste bei{' '}
                <a href="https://www.cardmarket.com/en/Magic/Data/Price-Guide" target="_blank" rel="noreferrer">
                  cardmarket.com
                </a>{' '}
                herunterladen (Price Guide) und die Datei hier ablegen.
              </li>
              <li>
                Eigene CSV: Spalten wie <span className="mono">Name, Set, Trend Price, Avg. Sell Price, Foil Trend</span>{' '}
                werden automatisch erkannt.
              </li>
            </ol>
          </div>

          <button
            type="button"
            className="btn btn--danger btn--sm"
            style={{ justifySelf: 'start' }}
            onClick={() => void clearGame()}
          >
            Preisdaten für dieses Spiel löschen
          </button>
        </div>

        <div className="card">
          <div className="card__title">
            Preisliste durchsuchen
            <span className="dim small">Verkaufspreis inkl. Aufschlag</span>
          </div>
          <input
            placeholder="Kartenname eingeben …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {hits.length === 0 ? (
            <p className="muted small" style={{ marginTop: 12 }}>
              {query.trim().length < 2 ? 'Mindestens zwei Zeichen eingeben.' : 'Keine Treffer.'}
            </p>
          ) : (
            <ul className="list-reset divide" style={{ marginTop: 12 }}>
              {hits.map((entry) => {
                const base = readBasisWithFallback(entry, settings.nonFoil.basis, false);
                // Foil nur ausweisen, wenn der Datensatz auch Foil-Preise mitbringt
                const hasFoilData = Boolean(entry.foilTrend ?? entry.foilSell ?? entry.foilLow);
                const foilBase = hasFoilData ? readBasisWithFallback(entry, settings.foil.basis, true) : null;
                const sell = calculatePrice(
                  {
                    id: 'preview',
                    gameId: entry.gameId,
                    name: entry.name,
                    set: entry.set,
                    condition: 'NM',
                    language: 'EN',
                    foil: false,
                    quantity: 1,
                    priceEntryId: entry.id,
                    createdAt: 0,
                    updatedAt: 0,
                  },
                  entry,
                  ctx,
                ).sellPrice;
                const foilSell = calculatePrice(
                  {
                    id: 'preview-foil',
                    gameId: entry.gameId,
                    name: entry.name,
                    set: entry.set,
                    condition: 'NM',
                    language: 'EN',
                    foil: true,
                    quantity: 1,
                    priceEntryId: entry.id,
                    createdAt: 0,
                    updatedAt: 0,
                  },
                  entry,
                  ctx,
                ).sellPrice;
                return (
                  <li key={entry.id}>
                    <div className="row row--between">
                      <span>
                        <span className="cell-main">{entry.name}</span>
                        <br />
                        <span className="cell-sub">
                          {entry.set ?? 'ohne Set'}
                          {entry.cardmarketProductId ? ` · #${entry.cardmarketProductId}` : ''}
                        </span>
                      </span>
                      <span className="num">
                        <strong>{formatMoney(sell, settings, { showCode: false })}</strong>
                        <br />
                        <span className="cell-sub">Basis {formatMoney(base?.value ?? null, settings, { showCode: false })}</span>
                      </span>
                    </div>
                    {foilBase ? (
                      <div className="row row--between small dim" style={{ marginTop: 2 }}>
                        <span className="badge badge--foil">Foil</span>
                        <span className="num">
                          {formatMoney(foilSell, settings, { showCode: false })}{' '}
                          <span className="dim">(Basis {formatMoney(foilBase.value, settings, { showCode: false })})</span>
                        </span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
