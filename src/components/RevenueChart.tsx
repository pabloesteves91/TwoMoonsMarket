import { useMemo, useState } from 'react';
import { convert, formatMoney } from '../lib/format';
import type { Sale, Settings } from '../types';

/**
 * Umsatz je Woche als Balken.
 *
 * Eine Serie, eine Farbe – die Balkenlänge trägt die Aussage, die Farbe muss sie
 * nicht doppeln. Achsen und Raster liegen als Haarlinien knapp über dem
 * Hintergrund; Werte stehen nicht an jedem Balken, sondern in der Y-Achse und im
 * Tooltip. Jeder Wert ist zusätzlich in der Verkaufsliste darunter lesbar.
 */
export default function RevenueChart({
  sales,
  settings,
  weeks = 12,
}: {
  sales: Sale[];
  settings: Settings;
  weeks?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const buckets = useMemo(() => {
    // Wochen beginnen am Montag – passend zum wöchentlichen Preisabruf
    const startOfWeek = (timestamp: number) => {
      const date = new Date(timestamp);
      date.setHours(0, 0, 0, 0);
      const weekday = (date.getDay() + 6) % 7;
      date.setDate(date.getDate() - weekday);
      return date.getTime();
    };

    const thisWeek = startOfWeek(Date.now());
    const week = 7 * 24 * 3600 * 1000;
    const list = Array.from({ length: weeks }, (_, index) => {
      const start = thisWeek - (weeks - 1 - index) * week;
      return { start, revenue: 0, profit: 0, cards: 0 };
    });

    for (const sale of sales) {
      const start = startOfWeek(sale.soldAt);
      const bucket = list.find((entry) => entry.start === start);
      if (!bucket) continue;
      bucket.revenue += sale.unitPrice * sale.quantity;
      bucket.cards += sale.quantity;
      if (sale.purchasePrice !== undefined) {
        bucket.profit += (sale.unitPrice - sale.purchasePrice) * sale.quantity;
      }
    }
    return list;
  }, [sales, weeks]);

  const max = Math.max(...buckets.map((bucket) => bucket.revenue), 1);
  // Auf eine runde Zahl aufrunden, damit die Achse lesbare Schritte bekommt
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];

  const label = (start: number) =>
    new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: '2-digit' }).format(start);

  return (
    <figure className="chart">
      {/* Achse, Balken und Beschriftung in einem Raster: nur so stehen die Daten
          exakt unter ihren Balken, auch wenn sich die Achsenbreite ändert. */}
      <div className="chart__plot">
        <div className="chart__axis" aria-hidden>
          {[...ticks].reverse().map((tick) => (
            <span key={tick}>{convert(tick, settings).toFixed(0)}</span>
          ))}
        </div>

        <div className="chart__bars">
          {ticks.map((tick) => (
            <div key={tick} className="chart__grid" style={{ bottom: `${(tick / top) * 100}%` }} aria-hidden />
          ))}

          {buckets.map((bucket, index) => {
            const height = (bucket.revenue / top) * 100;
            // Tooltip am Rand nach innen ziehen, sonst läuft er aus der Karte
            const edge = index === 0 ? ' chart__tip--start' : index === buckets.length - 1 ? ' chart__tip--end' : '';
            return (
              <button
                key={bucket.start}
                type="button"
                className={`chart__col${hover === index ? ' is-hover' : ''}`}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(null)}
                aria-label={`Woche ab ${label(bucket.start)}: ${formatMoney(bucket.revenue, settings)} Umsatz, ${
                  bucket.cards
                } Karten`}
              >
                {bucket.revenue > 0 ? <span className="chart__bar" style={{ height: `${height}%` }} /> : null}
                {hover === index ? (
                  <span className={`chart__tip${edge}`} style={{ bottom: `calc(${height}% + 8px)` }} role="status">
                    <strong>Woche ab {label(bucket.start)}</strong>
                    <br />
                    Umsatz {formatMoney(bucket.revenue, settings)}
                    <br />
                    {bucket.cards} {bucket.cards === 1 ? 'Karte' : 'Karten'}
                    {bucket.profit !== 0 ? (
                      <>
                        <br />
                        Gewinn {formatMoney(bucket.profit, settings)}
                      </>
                    ) : null}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="chart__labels" aria-hidden>
          {buckets.map((bucket, index) => (
            <span key={bucket.start}>{index % 2 === buckets.length % 2 ? label(bucket.start) : ''}</span>
          ))}
        </div>
      </div>

      <figcaption className="small dim">
        Umsatz je Woche in {settings.currency}, Wochenbeginn Montag. Einzelwerte stehen in der Liste darunter.
      </figcaption>
    </figure>
  );
}
