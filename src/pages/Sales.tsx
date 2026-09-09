import { useMemo, useState } from 'react';
import RevenueChart from '../components/RevenueChart';
import { useStore } from '../store';
import { isStoreOnly, useAuth } from '../firebase/authContext';
import { convert, downloadFile, formatDate, formatMoney, formatNumber, formatPercent } from '../lib/format';
import { toCsv } from '../lib/csv';
import { SALE_CHANNEL_LABELS, type Sale } from '../types';

type Range = 30 | 90 | 365 | 0;

const RANGE_LABELS: Record<Range, string> = {
  30: 'Letzte 30 Tage',
  90: 'Letzte 90 Tage',
  365: 'Letzte 12 Monate',
  0: 'Alles',
};

/** Beginn des heutigen Tages – Grenze für das, was das Verkaufskonto stornieren darf. */
function heuteAb(): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

export default function Sales() {
  const { sales, settings, games, gameById, cancelSale } = useStore();
  const { user, member } = useAuth();
  /**
   * Verkaufskonto: sieht die eigenen Buchungen des Tages und kann sie
   * zurücknehmen – ein Vertipper am Tresen soll nicht auf die Leitung warten.
   * Ältere und fremde Verkäufe bleiben unangetastet.
   */
  const storeOnly = isStoreOnly(member);
  const [range, setRange] = useState<Range>(30);
  const [gameFilter, setGameFilter] = useState('');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const from = range === 0 ? 0 : Date.now() - range * 24 * 3600 * 1000;
    const query = search.trim().toLowerCase();
    const eigeneGrenze = heuteAb();
    return sales.filter((sale) => {
      // Das Verkaufskonto sieht nur die eigenen Buchungen von heute
      if (storeOnly && (sale.soldBy !== user?.uid || sale.soldAt < eigeneGrenze)) return false;
      if (sale.soldAt < from) return false;
      if (gameFilter && sale.gameId !== gameFilter) return false;
      if (!query) return true;
      return [sale.name, sale.set, sale.note].filter(Boolean).some((value) =>
        String(value).toLowerCase().includes(query),
      );
    });
  }, [sales, range, gameFilter, search, storeOnly, user?.uid]);

  const stats = useMemo(() => {
    let revenue = 0;
    let cost = 0;
    let cards = 0;
    let withCost = 0;
    for (const sale of filtered) {
      revenue += sale.unitPrice * sale.quantity;
      cards += sale.quantity;
      if (sale.purchasePrice !== undefined) {
        cost += sale.purchasePrice * sale.quantity;
        withCost += sale.unitPrice * sale.quantity;
      }
    }
    return {
      revenue,
      cards,
      profit: withCost > 0 ? withCost - cost : null,
      marginPercent: cost > 0 ? ((withCost - cost) / cost) * 100 : null,
      average: cards > 0 ? revenue / cards : 0,
    };
  }, [filtered]);

  /** Bestseller nach Erlös – mehrere Verkäufe derselben Karte zusammengefasst. */
  const top = useMemo(() => {
    const map = new Map<string, { name: string; set?: string; cards: number; revenue: number }>();
    for (const sale of filtered) {
      const key = `${sale.gameId}|${sale.name}|${sale.set ?? ''}`;
      const entry = map.get(key) ?? { name: sale.name, set: sale.set, cards: 0, revenue: 0 };
      entry.cards += sale.quantity;
      entry.revenue += sale.unitPrice * sale.quantity;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [filtered]);

  const perGame = useMemo(
    () =>
      games
        .map((game) => {
          const rows = filtered.filter((sale) => sale.gameId === game.id);
          return {
            game,
            cards: rows.reduce((sum, sale) => sum + sale.quantity, 0),
            revenue: rows.reduce((sum, sale) => sum + sale.unitPrice * sale.quantity, 0),
          };
        })
        .filter((entry) => entry.cards > 0),
    [filtered, games],
  );

  function exportCsv() {
    const csv = toCsv(
      [
        'Datum',
        'Spiel',
        'Karte',
        'Set',
        'Zustand',
        'Sprache',
        'Foil',
        'Menge',
        `Preis/Stk (${settings.currency})`,
        `Erlös (${settings.currency})`,
        `Einkauf/Stk (${settings.currency})`,
        `Gewinn (${settings.currency})`,
        'Kanal',
        'Notiz',
      ],
      filtered.map((sale) => [
        new Date(sale.soldAt).toISOString().slice(0, 10),
        gameById.get(sale.gameId)?.short ?? sale.gameId,
        sale.name,
        sale.set ?? '',
        sale.condition,
        sale.language,
        sale.foil ? 'ja' : 'nein',
        sale.quantity,
        convert(sale.unitPrice, settings).toFixed(2),
        convert(sale.unitPrice * sale.quantity, settings).toFixed(2),
        sale.purchasePrice === undefined ? '' : convert(sale.purchasePrice, settings).toFixed(2),
        sale.purchasePrice === undefined
          ? ''
          : convert((sale.unitPrice - sale.purchasePrice) * sale.quantity, settings).toFixed(2),
        SALE_CHANNEL_LABELS[sale.channel] ?? sale.channel,
        sale.note ?? '',
      ]),
    );
    downloadFile(
      `twomoons-verkaeufe-${new Date().toISOString().slice(0, 10)}.csv`,
      '﻿' + csv,
      'text/csv;charset=utf-8',
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Verkäufe</h1>
          <p>
            {storeOnly
              ? 'Deine Buchungen von heute. Ein Verkauf aus Versehen lässt sich hier zurücknehmen.'
              : 'Was verkauft wurde, zu welchem Preis und mit welchem Gewinn.'}
          </p>
        </div>
        {storeOnly ? null : (
          <div className="page-head__actions">
            <button type="button" className="btn" onClick={exportCsv} disabled={filtered.length === 0}>
              CSV exportieren
            </button>
          </div>
        )}
      </div>

      {/* Eine Filterzeile für alles darunter – Kennzahlen, Diagramm und Liste */}
      <div className="toolbar">
        <select value={range} onChange={(e) => setRange(Number(e.target.value) as Range)} aria-label="Zeitraum">
          {Object.entries(RANGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={gameFilter} onChange={(e) => setGameFilter(e.target.value)} aria-label="Spiel">
          <option value="">Alle Spiele</option>
          {games.map((game) => (
            <option key={game.id} value={game.id}>
              {game.name}
            </option>
          ))}
        </select>
        <input
          className="toolbar__search"
          placeholder="Karte oder Notiz suchen …"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid--stats">
        <div className="stat">
          <div className="stat__label">Umsatz</div>
          <div className="stat__value">{formatMoney(stats.revenue, settings)}</div>
          <div className="stat__hint">{RANGE_LABELS[range]}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Verkaufte Karten</div>
          <div className="stat__value">{formatNumber(stats.cards)}</div>
          <div className="stat__hint">
            {formatNumber(filtered.length)} {filtered.length === 1 ? 'Verkauf' : 'Verkäufe'} · Ø{' '}
            {formatMoney(stats.average, settings)} pro Karte
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">Gewinn</div>
          <div className="stat__value">{stats.profit === null ? '–' : formatMoney(stats.profit, settings)}</div>
          <div className="stat__hint">
            {stats.marginPercent === null
              ? 'keine Einkaufspreise erfasst'
              : `Marge ${formatPercent(stats.marginPercent)}`}
          </div>
        </div>
      </div>

      {sales.length > 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card__title">Umsatzverlauf</div>
          <RevenueChart sales={filtered} settings={settings} />
        </div>
      ) : null}

      <div className="grid grid--two" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card__title">Meistverkauft</div>
          {top.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              Noch keine Verkäufe im gewählten Zeitraum.
            </p>
          ) : (
            <ul className="list-reset divide">
              {top.map((entry) => (
                <li key={`${entry.name}|${entry.set}`} className="row row--between">
                  <span>
                    <span className="cell-main">{entry.name}</span>
                    <br />
                    <span className="cell-sub">
                      {entry.set ?? 'ohne Set'} · {formatNumber(entry.cards)}×
                    </span>
                  </span>
                  <span className="num">{formatMoney(entry.revenue, settings)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="card__title">Nach Spiel</div>
          {perGame.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              Noch keine Verkäufe im gewählten Zeitraum.
            </p>
          ) : (
            <ul className="list-reset divide">
              {perGame.map(({ game, cards, revenue }) => (
                <li key={game.id} className="row row--between">
                  <span>
                    <span className="badge badge--game" style={{ background: game.color }}>
                      {game.short}
                    </span>{' '}
                    <span className="cell-main">{game.name}</span>
                    <br />
                    <span className="cell-sub">{formatNumber(cards)} Karten</span>
                  </span>
                  <span className="num">{formatMoney(revenue, settings)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__title">
          Alle Verkäufe
          <span className="dim small">{formatNumber(filtered.length)}</span>
        </div>
        {filtered.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            {storeOnly
              ? 'Heute noch nichts gebucht. Verkäufe werden im Bestand über „Verkauft" erfasst.'
              : 'Keine Verkäufe im gewählten Zeitraum. Verkäufe werden im Bestand über „Verkauft" gebucht.'}
          </p>
        ) : (
          <ul className="list-reset divide">
            {filtered.map((sale) => (
              <SaleRow
                key={sale.id}
                sale={sale}
                storeOnly={storeOnly}
                onCancel={() => void cancelSale(sale.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function SaleRow({
  sale,
  storeOnly,
  onCancel,
}: {
  sale: Sale;
  storeOnly: boolean;
  onCancel: () => void;
}) {
  const { settings, gameById } = useStore();
  const total = sale.unitPrice * sale.quantity;
  const profit =
    sale.purchasePrice === undefined ? null : (sale.unitPrice - sale.purchasePrice) * sale.quantity;

  return (
    <li className="row row--between" style={{ gap: 10 }}>
      <span style={{ minWidth: 0 }}>
        <span className="cell-main">{sale.name}</span>
        <br />
        <span className="cell-sub">
          {formatDate(sale.soldAt)} · {gameById.get(sale.gameId)?.short ?? sale.gameId} ·{' '}
          {sale.set ?? 'ohne Set'} · {sale.condition}
          {sale.foil ? ' · Foil' : ''} · {sale.quantity}× ·{' '}
          {SALE_CHANNEL_LABELS[sale.channel] ?? sale.channel}
          {sale.note ? ` · ${sale.note}` : ''}
        </span>
      </span>
      <span className="row" style={{ flexWrap: 'nowrap' }}>
        <span className="num">
          <strong>{formatMoney(total, settings, { showCode: false })}</strong>
          <br />
          {storeOnly ? null : profit === null ? (
            <span className="cell-sub">kein Einkauf</span>
          ) : (
            <span className={`cell-sub ${profit >= 0 ? 'pos' : 'neg'}`}>
              {profit >= 0 ? '+' : ''}
              {formatMoney(profit, settings, { showCode: false })}
            </span>
          )}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          title="Verkauf zurücknehmen – die Menge wandert zurück in den Bestand"
          onClick={() => {
            if (
              confirm(
                `Verkauf von "${sale.name}" zurücknehmen? ${sale.quantity} Karte(n) gehen zurück in den Bestand.`,
              )
            )
              onCancel();
          }}
        >
          Rückgängig
        </button>
      </span>
    </li>
  );
}
