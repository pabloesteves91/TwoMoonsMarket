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
import type { PriceStats } from './db/repository';
import { buildPriceContext, calculatePrice, findPriceEntry } from './lib/pricing';
import type {
  Game,
  InventoryItem,
  PriceCalculation,
  PriceEntry,
  RuleOverride,
  Settings,
} from './types';

/** Ein Bestandseintrag zusammen mit seinem berechneten Verkaufspreis. */
export interface PricedItem {
  item: InventoryItem;
  entry?: PriceEntry;
  calc: PriceCalculation;
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
  settings: Settings;
  items: InventoryItem[];
  overrides: RuleOverride[];
  priceStats: PriceStats[];
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
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [games, setGames] = useState<Game[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [overrides, setOverrides] = useState<RuleOverride[]>([]);
  const [entries, setEntries] = useState<PriceEntry[]>([]);
  const [priceStats, setPriceStats] = useState<PriceStats[]>([]);

  const refresh = useCallback(async () => {
    const [nextGames, nextSettings, nextItems, nextOverrides, stats] = await Promise.all([
      repo.getGames(),
      repo.getSettings(),
      repo.getItems(),
      repo.getOverrides(),
      repo.getPriceStats(),
    ]);
    const nextEntries = await repo.resolveEntriesForItems(nextItems);
    setGames(nextGames);
    setSettings(nextSettings);
    setItems(nextItems);
    setOverrides(nextOverrides);
    setEntries(nextEntries);
    setPriceStats(stats);
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pricedItems = useMemo<PricedItem[]>(() => {
    if (!settings) return [];
    const ctx = buildPriceContext(settings, entries, overrides);
    return items.map((item) => {
      const entry = findPriceEntry(item, ctx);
      const calc = calculatePrice(item, entry, ctx);
      const totalSell = calc.sellPrice === null ? null : calc.sellPrice * item.quantity;
      const totalCost = item.purchasePrice === undefined ? null : item.purchasePrice * item.quantity;
      const margin =
        calc.sellPrice === null || item.purchasePrice === undefined
          ? null
          : calc.sellPrice - item.purchasePrice;
      const marginPercent =
        margin === null || !item.purchasePrice ? null : (margin / item.purchasePrice) * 100;

      const approvedPrice = item.approvedPrice ?? null;
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
          Math.abs(priceDelta) >= settings.approvalMinDelta &&
          Math.abs(priceDeltaPercent) >= settings.approvalMinPercent);

      return {
        item,
        entry,
        calc,
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
  }, [items, entries, overrides, settings]);

  const value = useMemo<StoreValue | null>(() => {
    if (!settings) return null;
    return {
      ready,
      games,
      settings,
      items,
      overrides,
      priceStats,
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
  }, [ready, games, settings, items, overrides, priceStats, pricedItems, refresh]);

  if (!value) {
    return (
      <div className="boot">
        <div className="boot__logo">◑◐</div>
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
