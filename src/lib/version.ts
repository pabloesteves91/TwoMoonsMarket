/**
 * Erkennt, dass eine neuere Fassung der App veröffentlicht wurde.
 *
 * Ohne das bleibt eine geöffnete Seite auf dem Stand, an dem sie geladen wurde
 * – am Handy oft tagelang, weil der Tab nie geschlossen wird. Nach einer
 * Veröffentlichung sah es dann aus, als sei nichts geschehen: die Rolle für den
 * Tresen griff nicht, die Franken-Umstellung fehlte. Die App fragt deshalb
 * selbst nach und sagt Bescheid.
 */

/** Beim Bauen eingesetzt (siehe vite.config.ts). */
declare const __BUILD_ID__: string;

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'entwicklung';

/**
 * Fragt die veröffentlichte Kennung ab.
 *
 * `cache: 'no-store'` ist hier wesentlich: mit einer zwischengespeicherten
 * Antwort würde die Prüfung genau das übersehen, wofür es sie gibt.
 */
export async function publishedBuildId(): Promise<string | null> {
  try {
    const antwort = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!antwort.ok) return null;
    const daten = (await antwort.json()) as { buildId?: string };
    return typeof daten.buildId === 'string' ? daten.buildId : null;
  } catch {
    // Kein Netz – beim nächsten Mal wieder
    return null;
  }
}

/** Ist die veröffentlichte Fassung eine andere als die laufende? */
export async function neuereFassungDa(): Promise<boolean> {
  const veroeffentlicht = await publishedBuildId();
  return Boolean(veroeffentlicht) && veroeffentlicht !== BUILD_ID;
}

/**
 * Beobachtet die veröffentlichte Fassung.
 *
 * Geprüft wird beim Start, danach stündlich und jedes Mal, wenn die Seite
 * wieder in den Vordergrund kommt – am Handy ist das der übliche Weg zurück
 * in die App.
 */
export function beobachteFassung(beiNeuerFassung: () => void, intervallMs = 60 * 60 * 1000): () => void {
  let beendet = false;

  const pruefen = async () => {
    if (beendet || document.visibilityState === 'hidden') return;
    if (await neuereFassungDa()) beiNeuerFassung();
  };

  void pruefen();
  const timer = window.setInterval(() => void pruefen(), intervallMs);
  const beiSichtbar = () => {
    if (document.visibilityState === 'visible') void pruefen();
  };
  document.addEventListener('visibilitychange', beiSichtbar);

  return () => {
    beendet = true;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', beiSichtbar);
  };
}
