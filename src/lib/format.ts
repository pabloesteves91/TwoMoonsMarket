import type { Settings } from '../types';

/**
 * Kurs von EUR in die Anzeigewährung.
 *
 * Ein Kurs von 0 oder ein leeres Feld würde jede Rechnung zerstören – dann
 * bleibt es bei 1, also beim Euro-Betrag.
 */
export function rate(settings: Pick<Settings, 'currency' | 'eurToChf'>): number {
  return settings.currency === 'CHF' && settings.eurToChf > 0 ? settings.eurToChf : 1;
}

/** Rechnet einen EUR-Betrag in die Anzeigewährung um. */
export function convert(amountEur: number, settings: Pick<Settings, 'currency' | 'eurToChf'>): number {
  return amountEur * rate(settings);
}

/** Rechnet einen Betrag aus der Anzeigewährung zurück in EUR (so wird gespeichert). */
export function toEur(amountDisplay: number, settings: Pick<Settings, 'currency' | 'eurToChf'>): number {
  return amountDisplay / rate(settings);
}

/**
 * Bereitet einen gespeicherten EUR-Betrag für ein Eingabefeld auf.
 * Leere Felder bleiben leer, damit "kein Wert" nicht als 0.00 erscheint.
 */
export function moneyInput(
  amountEur: number | null | undefined,
  settings: Pick<Settings, 'currency' | 'eurToChf'>,
): string {
  if (amountEur === null || amountEur === undefined || Number.isNaN(amountEur)) return '';
  return (Math.round(convert(amountEur, settings) * 100) / 100).toString();
}

/**
 * Formatiert einen Betrag, der bereits in der Anzeigewährung vorliegt.
 *
 * Nötig für Werte, die so eingegeben und gespeichert werden – etwa die
 * Freigabeschwelle. `formatMoney` würde sie ein zweites Mal umrechnen.
 */
export function formatDisplay(
  amount: number | null | undefined,
  settings: Pick<Settings, 'currency' | 'eurToChf'>,
  options: { showCode?: boolean } = {},
): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '–';
  const formatted = new Intl.NumberFormat('de-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return options.showCode === false ? formatted : `${formatted} ${settings.currency}`;
}

/** Formatiert einen in EUR gespeicherten Betrag in der Anzeigewährung. */
export function formatMoney(
  amountEur: number | null | undefined,
  settings: Pick<Settings, 'currency' | 'eurToChf'>,
  options: { showCode?: boolean } = {},
): string {
  if (amountEur === null || amountEur === undefined || Number.isNaN(amountEur)) return '–';
  return formatDisplay(convert(amountEur, settings), settings, options);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('de-CH').format(value);
}

export function formatPercent(value: number): string {
  return `${value > 0 ? '+' : ''}${new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 }).format(value)} %`;
}

export function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return 'nie';
  return new Intl.DateTimeFormat('de-CH', { dateStyle: 'short', timeStyle: 'short' }).format(timestamp);
}

export function formatRelative(timestamp: number | null | undefined): string {
  if (!timestamp) return 'nie';
  const diffHours = (Date.now() - timestamp) / 36e5;
  if (diffHours < 1) return 'vor wenigen Minuten';
  if (diffHours < 24) return `vor ${Math.round(diffHours)} h`;
  const days = Math.round(diffHours / 24);
  return days === 1 ? 'gestern' : `vor ${days} Tagen`;
}

export function uid(prefix = ''): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}${random}`;
}

export function downloadFile(filename: string, content: string | Blob, mime = 'text/plain;charset=utf-8'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Skaliert ein Bild auf max. `maxSize` px und liefert eine JPEG-Data-URL. */
export function resizeImage(file: File, maxSize = 900, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Bildformat wird nicht unterstützt.'));
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas nicht verfügbar.'));
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
