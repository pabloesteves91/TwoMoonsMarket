import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, type PricedItem } from '../store';
import {
  convert,
  downloadFile,
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
} from '../lib/format';
import { toCsv } from '../lib/csv';

/**
 * Arbeitsliste für die Vitrine: vergleicht den Preis, der auf der Hülle steht
 * (zuletzt abgehakt), mit dem aktuell berechneten.
 *
 * Verkauft wird immer zum aktuellen Preis – diese Seite steuert ihn nicht, sie
 * sagt nur, welche Hüllen neu beschriftet gehören. Abhaken heisst deshalb
 * "erledigt", nicht "ab jetzt gilt"; die Karte verschwindet damit aus der Liste –
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
      (row) =>
        row.needsApproval &&
        row.calc.sellPrice !== null &&
        // Ausverkaufte Einträge bleiben als Gedächtnis für eine Rücknahme in
        // der Datenbank. An ihnen ist nichts zu beschriften – sie liegen nicht
        // mehr in der Vitrine.
        row.item.quantity > 0 &&
        (!gameFilter || row.item.gameId === gameFilter),
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
      setDone(`${formatNumber(ids.length)} Karten abgehakt – die Hüllen tragen jetzt den aktuellen Preis.`);
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
          <h1>Freigabe</h1>
          <p>
            Hier stehen die Karten, deren Preis nicht mehr zu dem auf der Hülle passt. Verkauft wird bereits
            zum aktuellen Preis – schreibt ihn auf die Hülle und hakt die Karte ab, dann verschwindet sie aus
            der Liste.
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
          <div className="stat__label">Neu zu beschriften</div>
          <div className="stat__value">{formatNumber(all.length)}</div>
          <div className="stat__hint">
            {formatNumber(changes.length)} {changes.length === 1 ? 'Änderung' : 'Änderungen'} ·{' '}
            {formatNumber(firstTime.length)} noch nie beschriftet
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
                bisher auf der Hülle: {formatMoney(sums.alt, settings)} →{' '}
                {formatMoney(sums.neuVergleichbar, settings)}{' '}
                <span className={differenz >= 0 ? 'pos' : 'neg'}>
                  ({differenz >= 0 ? '+' : ''}
                  {formatMoney(differenz, settings, { showCode: false })} ·{' '}
                  {formatPercent((differenz / sums.alt) * 100)})
                </span>
              </>
            ) : (
              'alles noch nie beschriftet – kein Vorher-Wert'
            )}
          </div>
        </div>
      </div>

      {all.length === 0 ? (
        <div className="empty">
          <div className="empty__icon">✓</div>
          <p>
            Nichts zu tun – auf allen Hüllen steht der aktuelle Preis.
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
              {busy ? 'Hakt ab …' : `${formatNumber(selected.size)} abhaken`}
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
              hint="Diese Karten sind noch nie beschriftet worden. Preis auf die Hülle schreiben, dann abhaken."
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
