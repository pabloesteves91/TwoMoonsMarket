/**
 * Datenmodell für TwoMoons Market.
 *
 * Alle Preise werden intern in EUR gehalten (Cardmarket rechnet in EUR).
 * Die Anzeige kann über Settings.currency + Settings.eurToChf auf CHF
 * umgestellt werden.
 */

export type GameId = string;

/**
 * Ein Lagerort: Vitrine, Box 2, Event …
 *
 * Als eigene Liste statt als freier Text, damit am Tresen nur ausgewählt und
 * nicht getippt wird – sonst stehen "Vitrine", "vitrine" und "Vitrinne"
 * nebeneinander und keine Suche findet mehr alles.
 */
export interface StorageLocation {
  id: string;
  name: string;
  /** Reihenfolge in der Auswahl */
  sortIndex: number;
}

export interface Game {
  id: GameId;
  /** Anzeigename, z.B. "Magic: The Gathering" */
  name: string;
  /** Kurzform für Tabellen/Badges, z.B. "MTG" */
  short: string;
  /** idGame bei Cardmarket (1 = Magic, 3 = Yu-Gi-Oh!, 6 = Pokémon) */
  cardmarketGameId?: number;
  /** Pfadsegment auf cardmarket.com, z.B. "Magic" oder "Pokemon" */
  cardmarketSlug?: string;
  color: string;
  sortIndex: number;
}

/** Zustände nach Cardmarket-Skala. */
export const CONDITIONS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABELS: Record<Condition, string> = {
  MT: 'Mint',
  NM: 'Near Mint',
  EX: 'Excellent',
  GD: 'Good',
  LP: 'Light Played',
  PL: 'Played',
  PO: 'Poor',
};

/**
 * Sprachen zur Auswahl, in der Reihenfolge, in der sie im Laden vorkommen.
 * Cardmarket führt weitere; die stehen unten als Altbestand, damit früher
 * erfasste Karten ihre Sprache behalten und nicht stillschweigend umkippen.
 */
export const LANGUAGES = ['EN', 'DE', 'JP', 'CN', 'KO', 'FR', 'IT', 'ES'] as const;
export const LEGACY_LANGUAGES = ['PT', 'RU'] as const;
export type Language = (typeof LANGUAGES)[number] | (typeof LEGACY_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  EN: 'Englisch',
  DE: 'Deutsch',
  JP: 'Japanisch',
  CN: 'Chinesisch',
  KO: 'Koreanisch',
  FR: 'Französisch',
  IT: 'Italienisch',
  ES: 'Spanisch',
  PT: 'Portugiesisch',
  RU: 'Russisch',
};

/**
 * Ein Preis-Datensatz aus der Cardmarket-Preisliste.
 * Feldnamen folgen der Cardmarket-Price-Guide-Struktur.
 */
export interface PriceEntry {
  /** Interner Schlüssel: `${gameId}:${cardmarketProductId ?? matchKey}` */
  id: string;
  gameId: GameId;
  cardmarketProductId?: number;
  name: string;
  /** Set / Edition – im Laden die Abkürzung, z.B. "TLA" */
  set?: string;
  /** Ausgeschriebener Editionsname, z.B. "Avatar: The Last Airbender" */
  setName?: string;
  number?: string;
  rarity?: string;
  /** Normalisierter Schlüssel für das Matching mit Bestandseinträgen (Spiel|Name|Set) */
  matchKey: string;
  /** Normalisierter Schlüssel ohne Set (Spiel|Name) für unscharfes Matching */
  nameKey: string;

  // Non-Foil
  avg?: number;
  low?: number;
  lowEx?: number;
  trend?: number;
  germanProLow?: number;
  suggested?: number;
  avg1?: number;
  avg7?: number;
  avg30?: number;

  // Foil
  foilSell?: number;
  foilLow?: number;
  foilTrend?: number;
  foilAvg1?: number;
  foilAvg7?: number;
  foilAvg30?: number;

  /** Zeitpunkt des Imports */
  updatedAt: number;
  /** Herkunft, z.B. Dateiname oder "import-prices.mjs" */
  source?: string;
}

/**
 * Ein Block der Preisliste: alle Einträge, deren Name ein Wort mit diesem
 * Anfang enthält. Die Preislisten werden blockweise gespeichert, weil
 * hunderttausende Einzelzeilen in IndexedDB zu langsam zu schreiben sind.
 */
export interface PriceBucket {
  /** `${gameId}:${bucketKey}` */
  id: string;
  gameId: GameId;
  bucketKey: string;
  entries: PriceEntry[];
}

/** Kennzahlen je Spiel, damit Anzahl und Stand ohne Vollzugriff bekannt sind. */
export interface PriceMeta {
  gameId: GameId;
  count: number;
  updatedAt: number;
  source?: string;
}

/** Verfügbare Preisbasen für die Aufschlagsregel. */
export const PRICE_BASES = [
  'trend',
  'avg',
  'avg1',
  'avg7',
  'avg30',
  'low',
  'lowEx',
  'germanProLow',
  'suggested',
] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

export const PRICE_BASIS_LABELS: Record<PriceBasis, string> = {
  trend: 'Trend Price',
  avg: 'Avg. Sell Price',
  avg1: 'Ø 1 Tag',
  avg7: 'Ø 7 Tage',
  avg30: 'Ø 30 Tage',
  low: 'Low Price',
  lowEx: 'Low Price EX+',
  germanProLow: 'German Pro Low (DACH)',
  suggested: 'Suggested Price',
};

export const ROUNDINGS = ['none', '0.05', '0.10', '0.50', '1.00', 'psych'] as const;
export type Rounding = (typeof ROUNDINGS)[number];

export const ROUNDING_LABELS: Record<Rounding, string> = {
  none: 'Keine Rundung',
  '0.05': 'auf 0.05',
  '0.10': 'auf 0.10',
  '0.50': 'auf 0.50',
  '1.00': 'auf 1.00',
  psych: 'auf x.x9 (psychologisch)',
};

/** Eine vollständige Preisregel (Basis + Aufschlag + Rundung + Mindestpreis). */
export interface PricingRule {
  basis: PriceBasis;
  /** Aufschlag in Prozent, z.B. 15 für +15 % */
  markupPercent: number;
  /** Mindestverkaufspreis in EUR */
  minPrice: number;
  rounding: Rounding;
}

/** Teilweise Überschreibung einer Regel (Set- oder Karten-Ebene). */
export type PricingRuleOverride = Partial<PricingRule>;

export interface RuleOverride {
  /** `set:<gameId>:<normalisiertes Set>` oder `card:<priceEntryId>` */
  id: string;
  scope: 'set' | 'card';
  gameId: GameId;
  /** Set-Name bzw. Kartenname – nur für die Anzeige */
  label: string;
  nonFoil?: PricingRuleOverride;
  foil?: PricingRuleOverride;
  note?: string;
  updatedAt: number;
}

export interface Settings {
  id: 'settings';
  nonFoil: PricingRule;
  foil: PricingRule;
  /**
   * Zuschlag/Abschlag je Zustand in Prozent des berechneten NM-Preises.
   * Die Cardmarket-Preisliste bezieht sich auf NM-Ware.
   */
  conditionFactors: Record<Condition, number>;
  applyConditionFactors: boolean;
  /** Anzeigewährung */
  currency: 'EUR' | 'CHF';
  /**
   * Woher der Kurs kommt. "auto" nimmt den Kurs, den der wöchentliche
   * Preislauf von der Europäischen Zentralbank mitliefert; "manual" den
   * Wert aus `eurToChf`.
   */
  rateMode: 'auto' | 'manual';
  /** Kurs 1 EUR = x CHF – von Hand gepflegt oder zuletzt automatisch geholt */
  eurToChf: number;
  companyName: string;
  /** Zuletzt genutzte Spielauswahl in der Bestandsansicht */
  lastGameFilter?: string;
}

export interface InventoryItem {
  id: string;
  gameId: GameId;
  name: string;
  set?: string;
  number?: string;
  condition: Condition;
  language: Language;
  foil: boolean;
  signed?: boolean;
  /**
   * Professionell bewertet (PSA, BGS …). Bewusst nur ein Vermerk: der
   * Cardmarket-Preis gilt für ungeslabte Ware, eine bewertete Karte wird über
   * den Fixpreis ausgezeichnet.
   */
  graded?: boolean;
  quantity: number;
  /** Einkaufspreis pro Stück in EUR */
  purchasePrice?: number;
  /** Fixpreis pro Stück in EUR – überschreibt jede Regel */
  fixedPrice?: number;
  /**
   * Zuletzt freigegebener Verkaufspreis pro Stück in EUR.
   *
   * Verkauft wird zum aktuellen Preis der Regel (Basis + Aufschlag); dieser
   * Wert ist nur noch das Gedächtnis der Freigabe-Seite und springt als Preis
   * ein, wenn die Preisliste gar keinen Wert führt.
   */
  approvedPrice?: number;
  approvedAt?: number;
  /** Regel-Überschreibung nur für diesen Eintrag */
  ruleOverride?: PricingRuleOverride;
  /** Verknüpfung zu einem Preis-Datensatz (`PriceEntry.id`) */
  priceEntryId?: string;
  cardmarketProductId?: number;
  location?: string;
  note?: string;
  photoId?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Ein Verkauf. Bewusst mit Kopie von Name, Set und Zustand: der Bestandseintrag
 * kann später verschwinden, die Verkaufshistorie soll trotzdem lesbar bleiben.
 */
export interface Sale {
  id: string;
  /** Verknüpfung zum Bestandseintrag, sofern er noch existiert */
  itemId?: string;
  gameId: GameId;
  name: string;
  set?: string;
  condition: Condition;
  language: Language;
  foil: boolean;
  quantity: number;
  /** Verkaufspreis pro Stück in EUR */
  unitPrice: number;
  /** Einkaufspreis pro Stück in EUR zum Zeitpunkt des Verkaufs */
  purchasePrice?: number;
  soldAt: number;
  /** Konto, das den Verkauf gebucht hat – nur so lässt sich "eigener Verkauf" prüfen */
  soldBy?: string;
  /** Anzeigename oder E-Mail des Kontos, damit die Liste lesbar bleibt */
  soldByEmail?: string;
  channel: SaleChannel;
  note?: string;
  createdAt: number;
}

export const SALE_CHANNELS = ['laden', 'event', 'online', 'sonstiges'] as const;
export type SaleChannel = (typeof SALE_CHANNELS)[number];

export const SALE_CHANNEL_LABELS: Record<SaleChannel, string> = {
  laden: 'Laden',
  event: 'Event / Turnier',
  online: 'Online',
  sonstiges: 'Sonstiges',
};

export interface Photo {
  id: string;
  /** JPEG als Data-URL, auf max. 900 px skaliert */
  dataUrl: string;
  createdAt: number;
}

/** Ergebnis der Preisberechnung für einen Bestandseintrag. */
export interface PriceCalculation {
  /** Verkaufspreis pro Stück in EUR, null wenn keine Preisbasis gefunden */
  sellPrice: number | null;
  /** Rohwert der Preisbasis vor Aufschlag */
  basePrice: number | null;
  basis: PriceBasis;
  markupPercent: number;
  /** Woher die Regel stammt */
  ruleSource: 'fixed' | 'item' | 'card' | 'set' | 'global';
  conditionFactor: number;
  /** Grund, falls kein Preis berechnet werden konnte */
  reason?: string;
}
