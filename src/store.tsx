import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { repo } from './db';
import { toEur, uid } from './lib/format';
import {
  fetchPublishedRate,
  findNewerPrices,
  importPricesFromCloud,
  type CloudImportProgress,
  type PublishedRate,
} from './lib/cloudPrices';
import type { PriceStats } from './db/repository';
import { buildPriceContext, calculatePrice, findPriceEntry } from './lib/pricing';
import type {
  Game,
  InventoryItem,
  PriceCalculation,
  PriceEntry,
  RuleOverride,
  Sale,
  Settings,
  StorageLocation,
} from './types';

/** Ein Bestandseintrag zusammen mit seinem berechneten Verkaufspreis. */
export interface PricedItem {
  item: InventoryItem;
  entry?: PriceEntry;
  calc: PriceCalculation;
  /**
   * Preis, zu dem diese Karte über den Tresen geht, pro Stück in EUR:
   * Basis + Aufschlag, so wie die Preisregel ihn gerade rechnet. Liste,
   * Verkaufsdialog, Auswertung und Ausgaben nennen alle diesen Wert.
   */
  sellPrice: number | null;
  /** Verkaufswert der gesamten Menge in EUR */
  totalSell: number | null;
  /** Einkaufswert der gesamten Menge in EUR */
  totalCost: number | null;
  /** Marge pro Stück in EUR */
  margin: number | null;
  marginPercent: number | null;
  /** Preis, der am Kärtchen steht (zuletzt freigegeben) */
  approvedPrice: number | null;
  /** Differenz berechneter Preis minus Kärtchenpreis, pro Stück in EUR */
  priceDelta: number | null;
  priceDeltaPercent: number | null;
  /** Karte ist noch nie ausgezeichnet worden */
  neverApproved: boolean;
  /** Abweichung ist gross genug, um ein Umetikettieren vorzuschlagen */
  needsApproval: boolean;
}

interface StoreValue {
  ready: boolean;
  games: Game[];
  /** Lagerorte als gepflegte Liste – am Tresen wird ausgewählt, nicht getippt */
  locations: StorageLocation[];
  saveLocation: (location: StorageLocation) => Promise<void>;
  deleteLocation: (id: string) => Promise<void>;
  /** Verschiebt mehrere Einträge an einen Lagerort */
  moveItems: (itemIds: string[], location: string) => Promise<void>;
  settings: Settings;
  /** Kurs aus dem wöchentlichen Lauf, sofern vorhanden */
  publishedRate: PublishedRate | null;
  items: InventoryItem[];
  sales: Sale[];
  overrides: RuleOverride[];
  priceStats: PriceStats[];
  /** Läuft gerade ein automatischer Preisabgleich? */
  priceSync: CloudImportProgress | null;
  /** Warum der letzte Preisabgleich fehlschlug – null, solange alles gut ging */
  priceSyncError: string | null;
  pricedItems: PricedItem[];
  gameById: Map<string, Game>;
  refresh: () => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
  saveItem: (item: InventoryItem) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  saveOverride: (override: RuleOverride) => Promise<void>;
  deleteOverride: (id: string) => Promise<void>;
  saveGame: (game: Game) => Promise<void>;
  deleteGame: (id: string) => Promise<void>;
  /** Übernimmt die berechneten Preise als neuen Kärtchenpreis. */
  approvePrices: (itemIds: string[]) => Promise<void>;
  /** Bucht einen Verkauf und bucht die Menge aus dem Bestand aus. */
  recordSale: (sale: Sale) => Promise<void>;
  /** Storniert einen Verkauf; die Menge wandert zurück in den Bestand. */
  cancelSale: (saleId: string) => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

/**
 * Übersetzt einen Fehler des Preisabgleichs in einen Satz, mit dem man etwas
 * anfangen kann.
 *
 * Der häufigste Fall ist ein privates Fenster: dort steht nur wenig
 * Speicherplatz zur Verfügung, und die Preisliste ist mehrere Dutzend Megabyte
 * gross. Ohne Hinweis sieht man nur bei jeder Karte "kein Preis".
 */
export function describeSyncError(err: unknown): string {
  const error = err as { name?: string; message?: string } | null;
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`;

  if (/quota|storage|exceeded|NS_ERROR_FILE_NO_DEVICE_SPACE/i.test(text)) {
    return (
      'Die Preisliste passt nicht in den Speicher dieses Fensters. In einem privaten Fenster ist er stark ' +
      'begrenzt – in einem normalen Tab funktioniert es. Der Bestand selbst ist davon nicht betroffen.'
    );
  }
  if (/NetworkError|Failed to fetch|NetworkError when attempting/i.test(text)) {
    return 'Die Preisliste konnte nicht geladen werden – keine Verbindung. Der nächste Start versucht es erneut.';
  }
  if (/InvalidStateError|UnknownError|database/i.test(text)) {
    return (
      'Die Preisliste konnte nicht gespeichert werden. Das passiert, wenn der Browser die lokale Datenbank ' +
      'sperrt – etwa im privaten Modus oder bei blockierten Website-Daten.'
    );
  }
  return `Die Preisliste konnte nicht übernommen werden: ${error?.message ?? 'unbekannter Fehler'}`;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [games, setGames] = useState<Game[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [overrides, setOverrides] = useState<RuleOverride[]>([]);
  const [entries, setEntries] = useState<PriceEntry[]>([]);
  const [priceStats, setPriceStats] = useState<PriceStats[]>([]);
  const [priceSync, setPriceSync] = useState<CloudImportProgress | null>(null);
  /** Kurs aus dem wöchentlichen Lauf – gilt, solange nicht von Hand gepflegt wird */
  const [publishedRate, setPublishedRate] = useState<PublishedRate | null>(null);
  /** Grund, warum der letzte Preisabgleich nicht geklappt hat */
  const [priceSyncError, setPriceSyncError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextGames, nextSettings, nextItems, nextSales, nextOverrides, stats, nextLocations] = await Promise.all([
      repo.getGames(),
      repo.getSettings(),
      repo.getItems(),
      repo.getSales(),
      repo.getOverrides(),
      repo.getPriceStats(),
      repo.getLocations(),
    ]);
    const nextEntries = await repo.resolveEntriesForItems(nextItems);
    setGames(nextGames);
    setLocations(nextLocations);
    setSettings(nextSettings);
    setItems(nextItems);
    setSales(nextSales);
    setOverrides(nextOverrides);
    setEntries(nextEntries);
    setPriceStats(stats);
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Preise selbstständig abholen.
   *
   * Die Liste liegt im Web und wird wöchentlich neu veröffentlicht; jedes Gerät
   * hält nur eine Kopie zum schnellen Nachschlagen. Ist die Kopie veraltet oder
   * gar nicht vorhanden, holt die App die neue Fassung ohne Zutun – bisher
   * musste das auf jedem Gerät von Hand angestossen werden.
   */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    void (async () => {
      try {
        // Der Kurs zuerst: er ist ein paar Byte gross und soll auch dann
        // stimmen, wenn die Preisliste unverändert blieb.
        const rate = await fetchPublishedRate();
        if (rate && !cancelled) setPublishedRate(rate);

        const manifest = await findNewerPrices();
        if (!manifest || cancelled) return;
        const result = await importPricesFromCloud(manifest, await repo.getGames(), (progress) => {
          if (!cancelled) setPriceSync(progress);
        });
        if (cancelled) return;
        await refresh();

        // Einzelne Dateien werden übersprungen statt den ganzen Lauf zu kippen.
        // Das ist richtig – aber es darf nicht als Erfolg durchgehen, sonst
        // steht bei jeder Karte "kein Preis" und niemand weiss warum.
        if (result.skippedFiles.length > 0) {
          setPriceSyncError(
            `${result.skippedFiles.length} von ${result.files + result.skippedFiles.length} Preisdateien konnten ` +
              'nicht übernommen werden. Bei den betroffenen Karten fehlt der Preis.',
          );
        } else if (result.imported === 0) {
          setPriceSyncError('Die Preisliste kam leer an – bei den Karten fehlt deshalb der Preis.');
        } else {
          setPriceSyncError(null);
        }
      } catch (err) {
        // Bisher blieb ein Fehlschlag stumm: die App zeigte bei jeder Karte
        // "kein Preis", ohne den Grund zu nennen. Jetzt steht er da.
        if (!cancelled) setPriceSyncError(describeSyncError(err));
      } finally {
        if (!cancelled) setPriceSync(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, refresh]);

  /**
   * Einstellungen, wie der Rest der App sie sehen soll.
   *
   * Steht der Kurs auf "automatisch", gilt der Wert aus dem wöchentlichen Lauf.
   * Der gespeicherte Wert bleibt als Rückfall, wenn gerade kein Netz da ist.
   */
  const effectiveSettings = useMemo<Settings | null>(() => {
    if (!settings) return null;
    if (settings.rateMode === 'manual' || !publishedRate) return settings;
    return { ...settings, eurToChf: publishedRate.eurToChf };
  }, [settings, publishedRate]);

  const pricedItems = useMemo<PricedItem[]>(() => {
    if (!effectiveSettings) return [];
    const settings = effectiveSettings;
    const ctx = buildPriceContext(settings, entries, overrides);
    return items.map((item) => {
      const entry = findPriceEntry(item, ctx);
      const calc = calculatePrice(item, entry, ctx);
      const approvedPrice = item.approvedPrice ?? null;
      // Der Verkaufspreis ist Basis + Aufschlag, immer der aktuelle. Der zuletzt
      // ausgezeichnete Preis springt nur ein, wenn die Preisliste gerade gar
      // keinen Wert führt – sonst stünde eine Karte ohne Preis da, bloss weil
      // Cardmarket sie vorübergehend nicht listet.
      const sellPrice = calc.sellPrice ?? approvedPrice;
      const totalSell = sellPrice === null ? null : sellPrice * item.quantity;
      const totalCost = item.purchasePrice === undefined ? null : item.purchasePrice * item.quantity;
      const margin =
        sellPrice === null || item.purchasePrice === undefined ? null : sellPrice - item.purchasePrice;
      const marginPercent =
        margin === null || !item.purchasePrice ? null : (margin / item.purchasePrice) * 100;

      const neverApproved = approvedPrice === null && calc.sellPrice !== null;
      const priceDelta =
        calc.sellPrice === null || approvedPrice === null ? null : calc.sellPrice - approvedPrice;
      const priceDeltaPercent =
        priceDelta === null || !approvedPrice ? null : (priceDelta / approvedPrice) * 100;
      // Beide Grenzen müssen überschritten sein: ein paar Rappen auf einer teuren
      // Karte sind ebenso wenig ein Grund zum Umetikettieren wie 20 % auf 10 Rappen.
      const needsApproval =
        neverApproved ||
        (priceDelta !== null &&
          priceDeltaPercent !== null &&
          Math.abs(priceDelta) >= toEur(settings.approvalMinDelta, settings) &&
          Math.abs(priceDeltaPercent) >= settings.approvalMinPercent);

      return {
        item,
        entry,
        calc,
        sellPrice,
        totalSell,
        totalCost,
        margin,
        marginPercent,
        approvedPrice,
        priceDelta,
        priceDeltaPercent,
        neverApproved,
        needsApproval,
      };
    });
  }, [items, entries, overrides, effectiveSettings]);

  const value = useMemo<StoreValue | null>(() => {
    if (!effectiveSettings) return null;
    return {
      ready,
      games,
      locations,
      settings: effectiveSettings,
      publishedRate,
      items,
      sales,
      overrides,
      priceStats,
      priceSync,
      priceSyncError,
      pricedItems,
      gameById: new Map(games.map((g) => [g.id, g])),
      refresh,
      saveSettings: async (next) => {
        await repo.saveSettings(next);
        setSettings(next);
      },
      saveItem: async (item) => {
        await repo.saveItem(item);
        await refresh();
      },
      deleteItem: async (id) => {
        await repo.deleteItem(id);
        await refresh();
      },
      saveOverride: async (override) => {
        await repo.saveOverride(override);
        setOverrides(await repo.getOverrides());
      },
      deleteOverride: async (id) => {
        await repo.deleteOverride(id);
        setOverrides(await repo.getOverrides());
      },
      saveGame: async (game) => {
        await repo.saveGame(game);
        setGames(await repo.getGames());
      },
      deleteGame: async (id) => {
        await repo.deleteGame(id);
        await refresh();
      },
      recordSale: async (sale) => {
        await repo.saveSale(sale);
        // Verkaufte Menge ausbuchen. Der Eintrag bleibt auch bei Menge 0 stehen,
        // aus zwei Gründen: die Karte behält Set, Nummer, Foto und Einkaufspreis
        // für den Fall einer Rücknahme, und das Verkaufskonto kommt so ohne
        // Löschrechte auf dem Bestand aus. Aus der Liste sind leere Einträge
        // ausgeblendet, sie sind ja kein Lagerbestand mehr.
        const item = sale.itemId ? items.find((entry) => entry.id === sale.itemId) : undefined;
        if (item) {
          const rest = Math.max(0, item.quantity - sale.quantity);
          await repo.saveItem({ ...item, quantity: rest, updatedAt: Date.now() });
        }
        await refresh();
      },
      cancelSale: async (saleId) => {
        const sale = sales.find((entry) => entry.id === saleId);
        // Erst den Bestand herstellen, dann den Verkauf löschen. Andersherum
        // stünde bei einem Abbruch dazwischen weder der Verkauf noch die Karte
        // da – und die Security Rules erkennen den Rückbau am noch
        // vorhandenen Verkauf.
        if (sale) {
          const item = sale.itemId ? items.find((entry) => entry.id === sale.itemId) : undefined;
          if (item) {
            await repo.saveItem({ ...item, quantity: item.quantity + sale.quantity, updatedAt: Date.now() });
          } else {
            // Der Bestandseintrag ist beim Verkauf verschwunden – aus den
            // mitgeschriebenen Angaben lässt er sich wiederherstellen.
            const now = Date.now();
            await repo.saveItem({
              id: sale.itemId ?? uid('item_'),
              gameId: sale.gameId,
              name: sale.name,
              set: sale.set,
              condition: sale.condition,
              language: sale.language,
              foil: sale.foil,
              quantity: sale.quantity,
              purchasePrice: sale.purchasePrice,
              approvedPrice: sale.unitPrice,
              approvedAt: now,
              createdAt: now,
              updatedAt: now,
            });
          }
        }
        await repo.deleteSale(saleId);
        await refresh();
      },
      saveLocation: async (location) => {
        await repo.saveLocation(location);
        await refresh();
      },
      deleteLocation: async (id) => {
        await repo.deleteLocation(id);
        await refresh();
      },
      moveItems: async (itemIds, location) => {
        const wanted = new Set(itemIds);
        const now = Date.now();
        for (const item of items) {
          if (!wanted.has(item.id)) continue;
          await repo.saveItem({ ...item, location, updatedAt: now });
        }
        await refresh();
      },
      approvePrices: async (itemIds) => {
        const wanted = new Set(itemIds);
        const now = Date.now();
        for (const row of pricedItems) {
          if (!wanted.has(row.item.id) || row.calc.sellPrice === null) continue;
          await repo.saveItem({
            ...row.item,
            approvedPrice: row.calc.sellPrice,
            approvedAt: now,
            updatedAt: now,
          });
        }
        await refresh();
      },
    };
  }, [
    ready,
    games,
    locations,
    effectiveSettings,
    publishedRate,
    items,
    sales,
    overrides,
    priceStats,
    priceSync,
    priceSyncError,
    pricedItems,
    refresh,
  ]);

  if (!value) {
    return (
      <div className="boot">
        <img className="boot__logo" src="logo.png" alt="TwoMoons" />
        <p>TwoMoons Market wird geladen …</p>
      </div>
    );
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore muss innerhalb von <StoreProvider> verwendet werden.');
  return ctx;
}
