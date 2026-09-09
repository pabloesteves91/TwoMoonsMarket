import type { PricedItem } from '../store';
import type { Settings } from '../types';
import { toCsv } from './csv';
import { convert } from './format';

export type ExportFormat = 'full' | 'shop' | 'cardmarket';

export const EXPORT_LABELS: Record<ExportFormat, string> = {
  full: 'Vollständig (alle Felder)',
  shop: 'Shop-Import (kompakt)',
  cardmarket: 'Cardmarket-Stil (Produkt-ID, Menge, Preis)',
};

/** Erzeugt eine CSV aus den bewerteten Bestandseinträgen. */
export function buildInventoryCsv(rows: PricedItem[], settings: Settings, format: ExportFormat): string {
  const money = (valueEur: number | null | undefined): string =>
    valueEur === null || valueEur === undefined ? '' : convert(valueEur, settings).toFixed(2);

  if (format === 'cardmarket') {
    return toCsv(
      ['idProduct', 'name', 'expansion', 'condition', 'language', 'isFoil', 'count', 'price'],
      rows.map((row) => [
        row.item.cardmarketProductId ?? row.entry?.cardmarketProductId ?? '',
        row.item.name,
        row.item.set ?? '',
        row.item.condition,
        row.item.language,
        row.item.foil ? 'true' : 'false',
        row.item.quantity,
        money(row.sellPrice),
      ]),
    );
  }

  if (format === 'shop') {
    return toCsv(
      ['Spiel', 'Karte', 'Set', 'Zustand', 'Sprache', 'Foil', 'Menge', `Verkaufspreis (${settings.currency})`],
      rows.map((row) => [
        row.item.gameId,
        row.item.name,
        row.item.set ?? '',
        row.item.condition,
        row.item.language,
        row.item.foil ? 'ja' : 'nein',
        row.item.quantity,
        money(row.sellPrice),
      ]),
    );
  }

  return toCsv(
    [
      'Spiel',
      'Karte',
      'Set',
      'Nummer',
      'Zustand',
      'Sprache',
      'Foil',
      'Graded',
      'Menge',
      'Lagerort',
      'Preisbasis',
      `Basispreis (${settings.currency})`,
      'Aufschlag %',
      `Verkaufspreis (${settings.currency})`,
      `Verkaufswert gesamt (${settings.currency})`,
      `Einkaufspreis (${settings.currency})`,
      `Marge (${settings.currency})`,
      'Cardmarket-ID',
      'Notiz',
    ],
    rows.map((row) => [
      row.item.gameId,
      row.item.name,
      row.item.set ?? '',
      row.item.number ?? '',
      row.item.condition,
      row.item.language,
      row.item.foil ? 'ja' : 'nein',
      row.item.graded ? 'ja' : 'nein',
      row.item.quantity,
      row.item.location ?? '',
      row.calc.basis,
      money(row.calc.basePrice),
      row.calc.markupPercent,
      money(row.sellPrice),
      money(row.totalSell),
      money(row.item.purchasePrice),
      money(row.margin),
      row.item.cardmarketProductId ?? '',
      row.item.note ?? '',
    ]),
  );
}
