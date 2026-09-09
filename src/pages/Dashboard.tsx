import { Link } from 'react-router-dom';
import { useStore } from '../store';
import { formatDate, formatMoney, formatNumber, formatPercent } from '../lib/format';

export default function Dashboard() {
  const { pricedItems, settings, games, priceStats, items, sales } = useStore();

  // Verkäufe der letzten 30 Tage
  const since = Date.now() - 30 * 24 * 3600 * 1000;
  const recent = sales.filter((sale) => sale.soldAt >= since);
  const revenue30 = recent.reduce((sum, sale) => sum + sale.unitPrice * sale.quantity, 0);
  const cards30 = recent.reduce((sum, sale) => sum + sale.quantity, 0);
  const profit30 = recent
    .filter((sale) => sale.purchasePrice !== undefined)
    .reduce((sum, sale) => sum + (sale.unitPrice - (sale.purchasePrice ?? 0)) * sale.quantity, 0);

  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  const sellValue = pricedItems.reduce((sum, row) => sum + (row.totalSell ?? 0), 0);
  const costValue = pricedItems.reduce((sum, row) => sum + (row.totalCost ?? 0), 0);
  const withCost = pricedItems.filter((row) => row.totalCost !== null && row.totalSell !== null);
  const costOfPriced = withCost.reduce((sum, row) => sum + (row.totalCost ?? 0), 0);
  const sellOfPriced = withCost.reduce((sum, row) => sum + (row.totalSell ?? 0), 0);
  const marginPercent = costOfPriced > 0 ? ((sellOfPriced - costOfPriced) / costOfPriced) * 100 : null;
  const unpriced = pricedItems.filter((row) => row.sellPrice === null);
  const pending = pricedItems.filter((row) => row.needsApproval);
  const lastImport = priceStats.reduce<number | null>(
    (latest, stat) => (stat.updatedAt && (!latest || stat.updatedAt > latest) ? stat.updatedAt : latest),
    null,
  );

  const topItems = [...pricedItems]
    .filter((row) => row.totalSell !== null)
    .sort((a, b) => (b.totalSell ?? 0) - (a.totalSell ?? 0))
    .slice(0, 8);

  const perGame = games.map((game) => {
    const rows = pricedItems.filter((row) => row.item.gameId === game.id);
    return {
      game,
      units: rows.reduce((sum, row) => sum + row.item.quantity, 0),
      value: rows.reduce((sum, row) => sum + (row.totalSell ?? 0), 0),
      prices: priceStats.find((s) => s.gameId === game.id)?.count ?? 0,
    };
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>
            Bestand und Verkaufspreise auf einen Blick. Verkaufspreise werden aus der importierten
            Cardmarket-Preisliste plus Aufschlag berechnet.
          </p>
        </div>
        <div className="page-head__actions">
          <Link className="btn" to="/preise">
            Preise importieren
          </Link>
          <Link className="btn" to="/verkaeufe">
            Verkäufe
          </Link>
          <Link className="btn btn--primary" to="/bestand">
            Bestand öffnen
          </Link>
        </div>
      </div>

      <div className="grid grid--stats">
        <div className="stat">
          <div className="stat__label">Karten im Bestand</div>
          <div className="stat__value">{formatNumber(totalUnits)}</div>
          <div className="stat__hint">{formatNumber(items.length)} Einträge</div>
        </div>
        <div className="stat">
          <div className="stat__label">Verkaufswert</div>
          <div className="stat__value">{formatMoney(sellValue, settings)}</div>
          <div className="stat__hint">
            inkl. Aufschlag {settings.nonFoil.markupPercent} % / Foil {settings.foil.markupPercent} %
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">Einkaufswert</div>
          <div className="stat__value">{formatMoney(costValue, settings)}</div>
          <div className="stat__hint">
            {marginPercent === null ? 'keine Einkaufspreise erfasst' : `Marge ${formatPercent(marginPercent)}`}
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">Umsatz 30 Tage</div>
          <div className="stat__value">{formatMoney(revenue30, settings)}</div>
          <div className="stat__hint">
            {formatNumber(cards30)} Karten
            {profit30 !== 0 ? ` · Gewinn ${formatMoney(profit30, settings)}` : ''}
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">Preisliste</div>
          <div className="stat__value">{formatNumber(priceStats.reduce((s, p) => s + p.count, 0))}</div>
          <div className="stat__hint">Stand: {formatDate(lastImport)}</div>
        </div>
      </div>

      {priceStats.every((stat) => stat.count === 0) ? (
        <p className="notice notice--warn" style={{ marginTop: 16 }}>
          Auf diesem Gerät ist noch keine Preisliste geladen. Ohne sie schlägt die App beim Erfassen keine
          Karten vor und rechnet keine Verkaufspreise. <Link to="/preise">Jetzt laden</Link> – das dauert etwa
          eine Viertelminute und muss pro Gerät einmal gemacht werden.
        </p>
      ) : null}

      {pending.length > 0 ? (
        <p className="notice notice--ok" style={{ marginTop: 16 }}>
          Bei {formatNumber(pending.length)} Karten weicht der berechnete Preis vom Preis am Kärtchen ab.{' '}
          <Link to="/freigabe">Zur Preisfreigabe</Link>
        </p>
      ) : null}

      {unpriced.length > 0 ? (
        <p className="notice notice--warn" style={{ marginTop: 16 }}>
          {formatNumber(unpriced.length)} Einträge ohne Preis – Karte fehlt in der Preisliste oder Name/Set
          stimmen nicht überein. <Link to="/bestand?filter=unpriced">Anzeigen</Link>
        </p>
      ) : null}

      <div className="grid grid--two" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="card__title">Wertvollste Positionen</div>
          {topItems.length === 0 ? (
            <p className="muted small">Noch keine bewerteten Karten im Bestand.</p>
          ) : (
            <ul className="list-reset divide">
              {topItems.map((row) => (
                <li key={row.item.id} className="row row--between">
                  <span>
                    <span className="cell-main">{row.item.name}</span>
                    <br />
                    <span className="cell-sub">
                      {row.item.set ?? 'ohne Set'} · {row.item.condition} · {row.item.language}
                      {row.item.foil ? ' · Foil' : ''} · {row.item.quantity}×
                    </span>
                  </span>
                  <span className="num">{formatMoney(row.totalSell, settings)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="card__title">Nach Spiel</div>
          <ul className="list-reset divide">
            {perGame.map(({ game, units, value, prices }) => (
              <li key={game.id} className="row row--between">
                <span>
                  <span className="badge badge--game" style={{ background: game.color }}>
                    {game.short}
                  </span>{' '}
                  <span className="cell-main">{game.name}</span>
                  <br />
                  <span className="cell-sub">
                    {formatNumber(units)} Karten · {formatNumber(prices)} Preise
                  </span>
                </span>
                <span className="num">{formatMoney(value, settings)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
