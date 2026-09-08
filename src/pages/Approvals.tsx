import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, type PricedItem } from '../store';
import { formatDate, formatMoney, formatNumber, formatPercent, downloadFile } from '../lib/format';
import { toCsv } from '../lib/csv';
import { convert } from '../lib/format';

/**
 * Preisfreigabe: vergleicht den Preis am Kärtchen (zuletzt freigegeben) mit dem
 * aktuell berechneten. Nur was hier bestätigt wird, gilt als neuer Kärtchenpreis –
 * die Karten im Laden werden schliesslich von Hand umetikettiert.
 */
export default function Approvals() {
  const { pricedItems, settings, games, gameById, approvePrices } = useStore();
  const [gameFilter, setGameFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const { changes, firstTime } = useMemo(() => {
    const relevant = pricedItems.filter(
      (row) => row.needsApproval && row.calc.sellPrice !== null && (!gameFilter || row.item.gameId === gameFilter),
    );
    return {
      changes: relevant
        .filter((row) => !row.neverApproved)
        .sort((a, b) => Math.abs(b.priceDelta ?? 0) * b.item.quantity - Math.abs(a.priceDelta ?? 0) * a.item.quantity),
      firstTime: relevant.filter((row) => row.neverApproved).sort((a, b) => a.item.name.localeCompare(b.item.name)),
    };
  }, [pricedItems, gameFilter]);

  const all = [...changes, ...firstTime];
  const allSelected = all.length > 0 && all.every((row) => selected.has(row.item.id));

  // "Vorher" gibt es nur für Karten, die schon einmal ausgezeichnet wurden –
  // sonst würde der berechnete Preis mit sich selbst verglichen.
  const sums = all.reduce(
    (acc, row) => {
      if (!selected.has(row.item.id)) return acc;
      const neu = (row.calc.sellPrice ?? 0) * row.item.quantity;
      acc.neu += neu;
      acc.karten += row.item.quantity;
      if (row.approvedPrice !== null) {
        acc.alt += row.approvedPrice * row.item.quantity;
        acc.neuVergleichbar += neu;
      }
      return acc;
    },
    { alt: 0, neu: 0, neuVergleichbar: 0, karten: 0 },
  );
  const differenz = sums.neuVergleichbar - sums.alt;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply() {
    setBusy(true);
    try {
      const ids = [...selected];
      await approvePrices(ids);
      setDone(`${formatNumber(ids.length)} Karten übernommen. Die neuen Preise gelten ab jetzt als Kärtchenpreis.`);
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  /** Liste zum Ausdrucken bzw. Mitnehmen an die Vitrine. */
  function exportList() {
    const rows = all
      .filter((row) => selected.size === 0 || selected.has(row.item.id))
      .map((row) => [
        gameById.get(row.item.gameId)?.short ?? row.item.gameId,
        row.item.name,
        row.item.set ?? '',
        row.item.condition,
        row.item.language,
        row.item.foil ? 'Foil' : '',
        row.item.quantity,
        row.item.location ?? '',
        row.approvedPrice === null ? '' : convert(row.approvedPrice, settings).toFixed(2),
        convert(row.calc.sellPrice ?? 0, settings).toFixed(2),
      ]);
    const csv = toCsv(
      ['Spiel', 'Karte', 'Set', 'Zustand', 'Sprache', 'Foil', 'Menge', 'Lagerort', `alt (${settings.currency})`, `neu (${settings.currency})`],
      rows,
    );
    downloadFile(`twomoons-umetikettieren-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Preisfreigabe</h1>
          <p>
            Was sich seit der letzten Auszeichnung bewegt hat. Erst wenn ihr hier bestätigt, gilt der neue Preis
            als der Preis am Kärtchen – vorher bleibt alles, wie es in der Vitrine steht.
          </p>
        </div>
        <div className="page-head__actions">
          <select value={gameFilter} onChange={(e) => setGameFilter(e.target.value)} aria-label="Spiel">
            <option value="">Alle Spiele</option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {done ? (
        <p className="notice notice--ok" style={{ marginBottom: 16 }}>
          {done}
        </p>
      ) : null}

      <div className="grid grid--stats" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="stat__label">Zur Freigabe</div>
          <div className="stat__value">{formatNumber(all.length)}</div>
          <div className="stat__hint">
            {formatNumber(changes.length)} {changes.length === 1 ? 'Änderung' : 'Änderungen'} ·{' '}
            {formatNumber(firstTime.length)} neu auszuzeichnen
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">Ausgewählt</div>
          <div className="stat__value">{formatNumber(selected.size)}</div>
          <div className="stat__hint">{formatNumber(sums.karten)} Karten</div>
        </div>
        <div className="stat">
          <div className="stat__label">Wert der Auswahl</div>
          <div className="stat__value">{formatMoney(sums.neu, settings)}</div>
          <div className="stat__hint">
            {sums.alt > 0 ? (
              <>
                bereits ausgezeichnet: {formatMoney(sums.alt, settings)} →{' '}
                {formatMoney(sums.neuVergleichbar, settings)}{' '}
                <span className={differenz >= 0 ? 'pos' : 'neg'}>
                  ({differenz >= 0 ? '+' : ''}
                  {formatMoney(differenz, settings, { showCode: false })} ·{' '}
                  {formatPercent((differenz / sums.alt) * 100)})
                </span>
              </>
            ) : (
              'alles Erstauszeichnungen – kein Vorher-Wert'
            )}
          </div>
        </div>
      </div>

      {all.length === 0 ? (
        <div className="empty">
          <div className="empty__icon">✓</div>
          <p>
            Nichts zu tun – alle Preise am Kärtchen entsprechen der aktuellen Berechnung
            {settings.approvalMinDelta > 0
              ? ` (Schwelle: ${formatMoney(settings.approvalMinDelta, settings)} und ${settings.approvalMinPercent} %)`
              : ''}
            .
          </p>
          <Link className="btn" to="/preise">
            Preise aktualisieren
          </Link>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setSelected(allSelected ? new Set() : new Set(all.map((row) => row.item.id)))}
            >
              {allSelected ? 'Auswahl aufheben' : `Alle ${formatNumber(all.length)} auswählen`}
            </button>
            <button type="button" className="btn btn--sm" onClick={exportList}>
              Liste als CSV
            </button>
            <div className="spacer" />
            <button
              type="button"
              className="btn btn--primary"
              disabled={selected.size === 0 || busy}
              onClick={() => void apply()}
            >
              {busy ? 'Übernimmt …' : `${formatNumber(selected.size)} übernehmen`}
            </button>
          </div>

          {changes.length > 0 ? (
            <Section
              title="Preis hat sich bewegt"
              rows={changes}
              selected={selected}
              onToggle={toggle}
              settings={settings}
            />
          ) : null}

          {firstTime.length > 0 ? (
            <Section
              title="Noch nie ausgezeichnet"
              hint="Diese Karten haben noch keinen bestätigten Preis. Mit dem Übernehmen wird der berechnete Preis zum Kärtchenpreis."
              rows={firstTime}
              selected={selected}
              onToggle={toggle}
              settings={settings}
            />
          ) : null}
        </>
      )}
    </>
  );
}

function Section({
  title,
  hint,
  rows,
  selected,
  onToggle,
  settings,
}: {
  title: string;
  hint?: string;
  rows: PricedItem[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  settings: ReturnType<typeof useStore>['settings'];
}) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card__title">
        {title}
        <span className="dim small">{formatNumber(rows.length)}</span>
      </div>
      {hint ? <p className="card__hint">{hint}</p> : null}

      <ul className="list-reset divide">
        {rows.map((row) => {
          const checked = selected.has(row.item.id);
          return (
            <li key={row.item.id}>
              <label className="approval">
                <input type="checkbox" checked={checked} onChange={() => onToggle(row.item.id)} />
                <span className="approval__card">
                  <span className="cell-main">{row.item.name}</span>
                  <br />
                  <span className="cell-sub">
                    {row.item.set ?? 'ohne Set'} · {row.item.condition} · {row.item.language}
                    {row.item.foil ? ' · Foil' : ''} · {row.item.quantity}×
                    {row.item.location ? ` · ${row.item.location}` : ''}
                  </span>
                  {row.item.approvedAt ? (
                    <>
                      <br />
                      <span className="cell-sub">Ausgezeichnet am {formatDate(row.item.approvedAt)}</span>
                    </>
                  ) : null}
                </span>
                <span className="approval__price">
                  {row.approvedPrice === null ? (
                    <span className="dim small">neu</span>
                  ) : (
                    <span className="dim small">{formatMoney(row.approvedPrice, settings, { showCode: false })}</span>
                  )}
                  <span className="approval__arrow" aria-hidden>
                    →
                  </span>
                  <strong>{formatMoney(row.calc.sellPrice, settings, { showCode: false })}</strong>
                  {row.priceDeltaPercent !== null ? (
                    <span className={`small ${row.priceDeltaPercent >= 0 ? 'pos' : 'neg'}`}>
                      {formatPercent(row.priceDeltaPercent)}
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
