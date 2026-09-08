import type {
  Condition,
  InventoryItem,
  PriceBasis,
  PriceCalculation,
  PriceEntry,
  PricingRule,
  PricingRuleOverride,
  RuleOverride,
  Settings,
} from '../types';

/** Mapping Preisbasis -> Feld im PriceEntry, getrennt für Foil und Non-Foil. */
const BASIS_FIELDS: Record<PriceBasis, { nonFoil: keyof PriceEntry; foil: keyof PriceEntry }> = {
  trend: { nonFoil: 'trend', foil: 'foilTrend' },
  avg: { nonFoil: 'avg', foil: 'foilSell' },
  avg1: { nonFoil: 'avg1', foil: 'foilAvg1' },
  avg7: { nonFoil: 'avg7', foil: 'foilAvg7' },
  avg30: { nonFoil: 'avg30', foil: 'foilAvg30' },
  low: { nonFoil: 'low', foil: 'foilLow' },
  lowEx: { nonFoil: 'lowEx', foil: 'foilLow' },
  germanProLow: { nonFoil: 'germanProLow', foil: 'foilLow' },
  suggested: { nonFoil: 'suggested', foil: 'foilTrend' },
};

/**
 * Fallback-Reihenfolge, falls die gewünschte Basis im Datensatz fehlt.
 * Cardmarket liefert je nach Spiel/Datei nicht alle Spalten.
 */
const FALLBACK_ORDER: PriceBasis[] = ['trend', 'avg7', 'avg30', 'avg', 'avg1', 'germanProLow', 'lowEx', 'low', 'suggested'];

export function readBasis(entry: PriceEntry, basis: PriceBasis, foil: boolean): number | undefined {
  const field = BASIS_FIELDS[basis][foil ? 'foil' : 'nonFoil'];
  const value = entry[field];
  return typeof value === 'number' && value > 0 ? value : undefined;
}

/** Liest die Preisbasis, mit Fallback auf die erste verfügbare Spalte. */
export function readBasisWithFallback(
  entry: PriceEntry,
  basis: PriceBasis,
  foil: boolean,
): { value: number; basis: PriceBasis } | null {
  const direct = readBasis(entry, basis, foil);
  if (direct !== undefined) return { value: direct, basis };

  for (const fb of FALLBACK_ORDER) {
    const value = readBasis(entry, fb, foil);
    if (value !== undefined) return { value, basis: fb };
  }
  // Letzter Ausweg: Foil-Karte ohne Foil-Preise -> Non-Foil-Spalten nutzen.
  if (foil) {
    for (const fb of FALLBACK_ORDER) {
      const value = readBasis(entry, fb, false);
      if (value !== undefined) return { value, basis: fb };
    }
  }
  return null;
}

export function roundPrice(value: number, rounding: PricingRule['rounding']): number {
  switch (rounding) {
    case 'none':
      return Math.round(value * 100) / 100;
    case 'psych': {
      // Auf die nächste x.x9-Stufe aufrunden (0.09, 0.19, ... 1.99, 2.09 ...)
      const cents = Math.ceil((value * 100 - 9) / 10) * 10 + 9;
      return Math.max(0.09, cents / 100);
    }
    default: {
      const step = Number(rounding);
      if (!step) return Math.round(value * 100) / 100;
      return Math.round((Math.ceil(value / step) * step) * 100) / 100;
    }
  }
}

export function mergeRule(base: PricingRule, ...overrides: (PricingRuleOverride | undefined)[]): PricingRule {
  return overrides.reduce<PricingRule>((acc, override) => (override ? { ...acc, ...override } : acc), base);
}

export function setOverrideId(gameId: string, set: string): string {
  return `set:${gameId}:${normalize(set)}`;
}

/** Normalisiert Namen/Sets für Vergleiche und Matching. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function buildMatchKey(gameId: string, name: string, set?: string): string {
  return `${gameId}|${normalize(name)}|${set ? normalize(set) : ''}`;
}

export function buildNameKey(gameId: string, name: string): string {
  return `${gameId}|${normalize(name)}`;
}

/** Zerlegt einen Kartennamen in normalisierte Suchwörter (ohne Dubletten). */
export function buildWords(name: string): string[] {
  return [...new Set(normalize(name).split(' ').filter((word) => word.length > 0))];
}

/** Länge des Blockschlüssels, mit dem die Preisliste aufgeteilt wird. */
export const BUCKET_LENGTH = 3;

/** Blockschlüssel eines Wortes, z.B. "lightning" -> "lig", "ex" -> "ex_". */
export function bucketOf(word: string): string {
  return word.slice(0, BUCKET_LENGTH).padEnd(BUCKET_LENGTH, '_');
}

/**
 * Alle Blöcke, in denen ein Kartenname zu finden sein soll: einer je Wort.
 * Dadurch findet die Suche nach "bolt" auch "Lightning Bolt".
 */
export function bucketsOf(name: string): string[] {
  const words = buildWords(name);
  return words.length > 0 ? [...new Set(words.map(bucketOf))] : ['___'];
}

/** Der Block, in dem ein Eintrag zuverlässig liegt (erstes Wort des Namens). */
export function primaryBucketOf(name: string): string {
  return bucketsOf(name)[0];
}

export interface PriceContext {
  settings: Settings;
  /** RuleOverrides nach id */
  overrides: Map<string, RuleOverride>;
  /** PriceEntries nach PriceEntry.id */
  entriesById: Map<string, PriceEntry>;
  /** PriceEntries nach matchKey (Name + Set) */
  entriesByKey: Map<string, PriceEntry>;
  /** PriceEntries nach Name allein – nur genutzt, wenn eindeutig */
  entriesByName: Map<string, PriceEntry | 'ambiguous'>;
}

export function findPriceEntry(item: InventoryItem, ctx: PriceContext): PriceEntry | undefined {
  if (item.priceEntryId) {
    const direct = ctx.entriesById.get(item.priceEntryId);
    if (direct) return direct;
  }
  if (item.cardmarketProductId) {
    const byProduct = ctx.entriesById.get(`${item.gameId}:${item.cardmarketProductId}`);
    if (byProduct) return byProduct;
  }
  const byKey = ctx.entriesByKey.get(buildMatchKey(item.gameId, item.name, item.set));
  if (byKey) return byKey;

  const byName = ctx.entriesByName.get(buildNameKey(item.gameId, item.name));
  return byName && byName !== 'ambiguous' ? byName : undefined;
}

/**
 * Berechnet den Verkaufspreis für einen Bestandseintrag.
 *
 * Reihenfolge der Regeln (spezifisch schlägt allgemein):
 *   Fixpreis am Eintrag > Eintrags-Override > Karten-Override > Set-Override > globale Foil/Non-Foil-Regel
 */
export function calculatePrice(
  item: InventoryItem,
  entry: PriceEntry | undefined,
  ctx: PriceContext,
): PriceCalculation {
  const globalRule = item.foil ? ctx.settings.foil : ctx.settings.nonFoil;
  const conditionFactor =
    ctx.settings.applyConditionFactors ? (ctx.settings.conditionFactors[item.condition] ?? 100) / 100 : 1;

  if (item.fixedPrice && item.fixedPrice > 0) {
    return {
      sellPrice: round2(item.fixedPrice),
      basePrice: null,
      basis: globalRule.basis,
      markupPercent: 0,
      ruleSource: 'fixed',
      conditionFactor: 1,
    };
  }

  const cardOverride = entry ? ctx.overrides.get(`card:${entry.id}`) : undefined;
  const setName = entry?.set ?? item.set;
  const setOverride = setName ? ctx.overrides.get(setOverrideId(item.gameId, setName)) : undefined;

  const pick = (o?: RuleOverride) => (item.foil ? o?.foil : o?.nonFoil);
  const rule = mergeRule(globalRule, pick(setOverride), pick(cardOverride), item.ruleOverride);

  let ruleSource: PriceCalculation['ruleSource'] = 'global';
  if (pick(setOverride)) ruleSource = 'set';
  if (pick(cardOverride)) ruleSource = 'card';
  if (item.ruleOverride) ruleSource = 'item';

  if (!entry) {
    return {
      sellPrice: null,
      basePrice: null,
      basis: rule.basis,
      markupPercent: rule.markupPercent,
      ruleSource,
      conditionFactor,
      reason: 'Keine Preisdaten – Karte nicht in der importierten Preisliste gefunden.',
    };
  }

  const found = readBasisWithFallback(entry, rule.basis, item.foil);
  if (!found) {
    return {
      sellPrice: null,
      basePrice: null,
      basis: rule.basis,
      markupPercent: rule.markupPercent,
      ruleSource,
      conditionFactor,
      reason: 'Preisdatensatz gefunden, aber ohne verwertbaren Preis.',
    };
  }

  const withMarkup = found.value * (1 + rule.markupPercent / 100) * conditionFactor;
  const sellPrice = Math.max(roundPrice(withMarkup, rule.rounding), rule.minPrice);

  return {
    sellPrice: round2(sellPrice),
    basePrice: found.value,
    basis: found.basis,
    markupPercent: rule.markupPercent,
    ruleSource,
    conditionFactor,
    reason: found.basis !== rule.basis ? `Basis "${rule.basis}" fehlt, "${found.basis}" verwendet.` : undefined,
  };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildPriceContext(
  settings: Settings,
  entries: PriceEntry[],
  overrides: RuleOverride[],
): PriceContext {
  const entriesById = new Map<string, PriceEntry>();
  const entriesByKey = new Map<string, PriceEntry>();
  const entriesByName = new Map<string, PriceEntry | 'ambiguous'>();

  for (const entry of entries) {
    entriesById.set(entry.id, entry);
    if (!entriesByKey.has(entry.matchKey)) entriesByKey.set(entry.matchKey, entry);

    const nameKey = entry.nameKey ?? buildNameKey(entry.gameId, entry.name);
    const existing = entriesByName.get(nameKey);
    if (!existing) entriesByName.set(nameKey, entry);
    else if (existing !== 'ambiguous' && existing.id !== entry.id) entriesByName.set(nameKey, 'ambiguous');
  }

  return {
    settings,
    overrides: new Map(overrides.map((o) => [o.id, o])),
    entriesById,
    entriesByKey,
    entriesByName,
  };
}

export const DEFAULT_CONDITION_FACTORS: Record<Condition, number> = {
  MT: 105,
  NM: 100,
  EX: 85,
  GD: 70,
  LP: 60,
  PL: 45,
  PO: 30,
};

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  nonFoil: { basis: 'trend', markupPercent: 15, minPrice: 0.1, rounding: '0.10' },
  foil: { basis: 'trend', markupPercent: 15, minPrice: 0.2, rounding: '0.10' },
  conditionFactors: DEFAULT_CONDITION_FACTORS,
  applyConditionFactors: false,
  currency: 'EUR',
  eurToChf: 0.95,
  companyName: 'TwoMoons AG, Dübendorf',
  approvalMinDelta: 0.2,
  approvalMinPercent: 5,
};
