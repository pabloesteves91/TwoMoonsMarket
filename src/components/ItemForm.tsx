import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from './Modal';
import PhotoInput from './PhotoInput';
import { repo } from '../db';
import { isStoreOnly, useAuth } from '../firebase/authContext';
import { formatMoney, formatNumber, moneyInput, toEur, uid } from '../lib/format';
import {
  PRICE_BASES,
  PRICE_BASIS_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  LANGUAGES,
  LANGUAGE_LABELS,
  type Condition,
  type InventoryItem,
  type Language,
  type PriceEntry,
} from '../types';
import { buildPriceContext, calculatePrice, findPriceEntry } from '../lib/pricing';
import { useStore } from '../store';

interface ItemFormProps {
  item?: InventoryItem;
  onClose: () => void;
}

/** Felder, die beim Erfassen einer Serie gleich bleiben. */
function carryOver(item: InventoryItem): Partial<InventoryItem> {
  return {
    gameId: item.gameId,
    set: item.set,
    condition: item.condition,
    language: item.language,
    foil: item.foil,
    location: item.location,
  };
}

function emptyItem(gameId: string): InventoryItem {
  return {
    id: uid('item_'),
    gameId,
    name: '',
    condition: 'NM',
    language: 'EN',
    foil: false,
    quantity: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export default function ItemForm({ item, onClose }: ItemFormProps) {
  const { games, settings, overrides, saveItem, deleteItem, priceStats, locations, saveLocation } = useStore();
  const { member } = useAuth();
  /** Das Verkaufskonto wählt nur aus; neue Orte legt die Leitung an. */
  const darfOrteAnlegen = !isStoreOnly(member);
  const [draft, setDraft] = useState<InventoryItem>(item ?? emptyItem(games[0]?.id ?? 'mtg'));
  const [suggestions, setSuggestions] = useState<PriceEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [matchedEntry, setMatchedEntry] = useState<PriceEntry | undefined>();
  const [useOverride, setUseOverride] = useState(Boolean(item?.ruleOverride));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Zähler und Rückmeldung für die Serienerfassung */
  const [savedCount, setSavedCount] = useState(0);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  /**
   * Getippter Text der Geldfelder. Ohne eigenen Zustand würde das Feld beim
   * Hin- und Herrechnen springen ("12.5" → "12.499999").
   */
  const [purchaseInput, setPurchaseInput] = useState(() => moneyInput(item?.purchasePrice, settings));
  /** Lagerort anlegen – nur die Leitung sieht diesen Weg */
  const [legtOrtAn, setLegtOrtAn] = useState(false);
  const [neuerOrt, setNeuerOrt] = useState('');
  const [fixedInput, setFixedInput] = useState(() => moneyInput(item?.fixedPrice, settings));
  const searchTimer = useRef<number>();
  const nameRef = useRef<HTMLInputElement>(null);

  const game = games.find((entry) => entry.id === draft.gameId);
  /** Ohne geladene Preisliste kann die App weder vorschlagen noch rechnen. */
  const priceCount = priceStats.find((stat) => stat.gameId === draft.gameId)?.count ?? 0;
  const hasPriceList = priceCount > 0;

  const patch = (changes: Partial<InventoryItem>) => setDraft((prev) => ({ ...prev, ...changes }));

  // Vorschläge aus der importierten Preisliste
  useEffect(() => {
    window.clearTimeout(searchTimer.current);
    if (draft.name.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    setSearching(true);
    searchTimer.current = window.setTimeout(() => {
      void repo.searchPriceEntries(draft.name, draft.gameId, 12).then((hits) => {
        setSuggestions(hits);
        setSearching(false);
      });
    }, 220);
    return () => window.clearTimeout(searchTimer.current);
  }, [draft.name, draft.gameId]);

  // Aktuell passender Preis-Datensatz für die Vorschau
  useEffect(() => {
    let active = true;
    if (!draft.name.trim()) {
      setMatchedEntry(undefined);
      return;
    }
    void repo.resolveEntriesForItems([draft]).then((entries) => {
      if (!active) return;
      const ctx = buildPriceContext(settings, entries, overrides);
      setMatchedEntry(findPriceEntry(draft, ctx));
    });
    return () => {
      active = false;
    };
  }, [draft, settings, overrides]);

  const preview = useMemo(() => {
    const ctx = buildPriceContext(settings, matchedEntry ? [matchedEntry] : [], overrides);
    return calculatePrice(draft, matchedEntry, ctx);
  }, [draft, matchedEntry, settings, overrides]);


  /** Legt den getippten Ort an und wählt ihn gleich aus. */
  async function ortAnlegen() {
    const name = neuerOrt.trim();
    if (!name) return;
    const vorhanden = locations.find((ort) => ort.name.toLowerCase() === name.toLowerCase());
    if (!vorhanden) {
      await saveLocation({ id: uid('loc_'), name, sortIndex: locations.length });
    }
    patch({ location: vorhanden?.name ?? name });
    setLegtOrtAn(false);
    setNeuerOrt('');
  }

  function applySuggestion(entry: PriceEntry) {
    // Set (Abkürzung) und Sammlernummer kommen aus dem Vorschlag, damit beim
    // Erfassen nichts abgetippt werden muss.
    patch({
      name: entry.name,
      set: entry.set,
      number: entry.number ?? draft.number,
      priceEntryId: entry.id,
      cardmarketProductId: entry.cardmarketProductId,
    });
    setShowSuggestions(false);
  }

  /**
   * Speichert den Eintrag. `andNext` hält die Maske für die nächste Karte offen
   * und behält Spiel, Set, Zustand, Sprache, Foil und Lagerort bei – beim
   * Erfassen einer Kiste ändert sich meist nur der Name.
   */
  async function handleSave(andNext = false) {
    if (!draft.name.trim()) {
      setError('Bitte einen Kartennamen eingeben.');
      return;
    }
    if (!draft.quantity || draft.quantity < 1) {
      setError('Menge muss mindestens 1 sein.');
      return;
    }
    setSaving(true);
    try {
      const name = draft.name.trim();
      await saveItem({
        ...draft,
        name,
        set: draft.set?.trim() || undefined,
        ruleOverride: useOverride ? draft.ruleOverride ?? {} : undefined,
        // Neu erfasste Karten gelten als beschriftet – sie sollen nicht sofort
        // in der Freigabe stehen, die Hülle wird ja gerade jetzt geschrieben.
        approvedPrice: draft.approvedPrice ?? preview.sellPrice ?? undefined,
        approvedAt: draft.approvedPrice ? draft.approvedAt : preview.sellPrice ? Date.now() : undefined,
        updatedAt: Date.now(),
      });

      if (!andNext) {
        onClose();
        return;
      }

      setSavedCount((count) => count + 1);
      setLastSaved(name);
      setError(null);
      setDraft({ ...emptyItem(draft.gameId), ...carryOver(draft), id: uid('item_') });
      // Einkaufs- und Fixpreis gehören zur einzelnen Karte, nicht zur Kiste
      setPurchaseInput('');
      setFixedInput('');
      setSuggestions([]);
      setShowSuggestions(false);
      setSaving(false);
      nameRef.current?.focus();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <Modal
      title={
        item
          ? 'Eintrag bearbeiten'
          : savedCount > 0
            ? `Karte erfassen (${savedCount} gespeichert)`
            : 'Karte zum Bestand hinzufügen'
      }
      onClose={onClose}
      footer={
        <>
          {item ? (
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={() => {
                if (confirm(`"${item.name}" wirklich löschen?`)) void deleteItem(item.id).then(onClose);
              }}
            >
              Löschen
            </button>
          ) : null}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {savedCount > 0 ? 'Fertig' : 'Abbrechen'}
          </button>
          {!item ? (
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => void handleSave(true)}
              title="Speichern und gleich die nächste Karte erfassen"
            >
              + Nächste
            </button>
          ) : null}
          <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Speichert …' : 'Speichern'}
          </button>
        </>
      }
    >
      {error ? <p className="notice notice--error">{error}</p> : null}
      {lastSaved && !error ? (
        <p className="notice notice--ok">
          „{lastSaved}" gespeichert. Set, Zustand, Sprache und Lagerort bleiben für die nächste Karte stehen.
        </p>
      ) : null}

      <div className="field-row">
        <div>
          <label htmlFor="game">Spiel</label>
          <select id="game" value={draft.gameId} onChange={(e) => patch({ gameId: e.target.value })}>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="quantity">Menge</label>
          <input
            id="quantity"
            type="number"
            min={1}
            value={draft.quantity}
            onChange={(e) => patch({ quantity: Number(e.target.value) })}
          />
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <label htmlFor="name">Kartenname</label>
        <input
          id="name"
          ref={nameRef}
          // Nur beim Erfassen springt der Fokus ins Feld. Beim Bearbeiten einer
          // vorhandenen Karte klappte sonst sofort die Vorschlagsliste auf,
          // obwohl die Karte längst ausgewählt ist.
          autoFocus={!item}
          value={draft.name}
          autoComplete="off"
          placeholder="z.B. Lightning Bolt"
          onChange={(e) => {
            patch({ name: e.target.value, priceEntryId: undefined, cardmarketProductId: undefined });
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => window.setTimeout(() => setShowSuggestions(false), 150)}
        />
        {!hasPriceList ? (
          <p className="notice notice--warn" style={{ marginTop: 6 }}>
            Für {game?.name ?? 'dieses Spiel'} ist noch keine Preisliste geladen – deshalb gibt es weder
            Vorschläge noch einen berechneten Preis.{' '}
            <Link to="/preise" onClick={onClose}>
              Jetzt laden
            </Link>{' '}
            (dauert etwa eine Viertelminute, danach schlägt die App beim Tippen Karten vor).
          </p>
        ) : draft.name.trim().length >= 2 && !searching && suggestions.length === 0 ? (
          <p className="small dim" style={{ marginTop: 6 }}>
            Keine Karte mit diesem Namen in der Preisliste von {game?.short ?? game?.name}. Die Suche geht über
            Wortanfänge – „aang" findet „Aang, Swift Nomad". Stimmt das Spiel oben?
          </p>
        ) : hasPriceList && draft.name.trim().length < 2 ? (
          <p className="small dim" style={{ marginTop: 6 }}>
            Ab zwei Buchstaben schlägt die App Karten aus {formatNumber(priceCount)} Einträgen vor – Auswählen
            füllt Set und Preis automatisch.
          </p>
        ) : null}

        {showSuggestions && suggestions.length > 0 ? (
          <ul className="list-reset suggestions">
            {suggestions.map((entry) => (
              <li key={entry.id}>
                <button type="button" className="suggestion" onClick={() => applySuggestion(entry)}>
                  <span className="suggestion__text">
                    <span className="cell-main">{entry.name}</span>
                    <br />
                    <span className="cell-sub">
                      {/* Fehlt die Edition, ist die Cardmarket-Nummer immerhin
                          ein eindeutiges Merkmal für gleichnamige Karten. */}
                      {entry.set ? (
                        <strong className="suggestion__set">{entry.set}</strong>
                      ) : entry.cardmarketProductId ? (
                        `Cardmarket #${entry.cardmarketProductId}`
                      ) : (
                        'Set unbekannt'
                      )}
                      {entry.number ? ` · Nr. ${entry.number}` : ''}
                      {entry.rarity ? ` · ${entry.rarity}` : ''}
                      {entry.setName ? ` · ${entry.setName}` : ''}
                    </span>
                  </span>
                  <span className="suggestion__price">
                    {entry.trend ?? entry.avg ?? entry.low ?? entry.foilTrend ? (
                      formatMoney(entry.trend ?? entry.avg ?? entry.low ?? null, settings, { showCode: false })
                    ) : (
                      <span className="badge badge--warn">ohne Preis</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="field-row">
        <div>
          <label htmlFor="set">Set / Edition</label>
          <input id="set" value={draft.set ?? ''} onChange={(e) => patch({ set: e.target.value })} />
        </div>
        <div>
          <label htmlFor="number">Kartennummer</label>
          <input id="number" value={draft.number ?? ''} onChange={(e) => patch({ number: e.target.value })} />
        </div>
      </div>

      <div className="field-row">
        <div>
          <label htmlFor="condition">Zustand</label>
          <select
            id="condition"
            value={draft.condition}
            onChange={(e) => patch({ condition: e.target.value as Condition })}
          >
            {CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {condition} – {CONDITION_LABELS[condition]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="language">Sprache</label>
          <select
            id="language"
            value={draft.language}
            onChange={(e) => patch({ language: e.target.value as Language })}
          >
            {/* Die eigene Sprache steht immer zur Wahl – sonst verlöre eine
                früher erfasste Karte beim Speichern stillschweigend ihre. */}
            {(LANGUAGES.includes(draft.language as (typeof LANGUAGES)[number])
              ? [...LANGUAGES]
              : [...LANGUAGES, draft.language]
            ).map((language) => (
              <option key={language} value={language}>
                {language} · {LANGUAGE_LABELS[language as Language] ?? language}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="field__label">Ausführung</span>
          <label className="checkbox" style={{ height: 38 }}>
            <input type="checkbox" checked={draft.foil} onChange={(e) => patch({ foil: e.target.checked })} />
            Foil
          </label>
        </div>
      </div>

      <div className="field-row">
        <div>
          {/* Eingetippt wird in der Währung, in der auch ausgepreist wird;
              gespeichert wird wie überall in Euro. */}
          <label htmlFor="purchase">Einkaufspreis pro Stück ({settings.currency})</label>
          <input
            id="purchase"
            type="number"
            step="0.01"
            min={0}
            value={purchaseInput}
            onChange={(e) => {
              setPurchaseInput(e.target.value);
              patch({ purchasePrice: e.target.value === '' ? undefined : toEur(Number(e.target.value), settings) });
            }}
          />
        </div>
        <div>
          <label htmlFor="fixed">Fixpreis ({settings.currency}, optional)</label>
          <input
            id="fixed"
            type="number"
            step="0.01"
            min={0}
            placeholder="überschreibt die Regel"
            value={fixedInput}
            onChange={(e) => {
              setFixedInput(e.target.value);
              patch({ fixedPrice: e.target.value === '' ? undefined : toEur(Number(e.target.value), settings) });
            }}
          />
        </div>
        <div>
          <label htmlFor="location">Lagerort</label>
          {/* Ausgewählt statt getippt: sonst stehen "Vitrine", "vitrine" und
              "Vitrinne" nebeneinander und keine Suche findet mehr alles.
              Anlegen darf nur die Leitung. */}
          <select
            id="location"
            value={draft.location ?? ''}
            onChange={(e) => {
              if (e.target.value === '__neu') {
                setNeuerOrt('');
                setLegtOrtAn(true);
                return;
              }
              patch({ location: e.target.value || undefined });
            }}
          >
            <option value="">(kein Lagerort)</option>
            {locations.map((ort) => (
              <option key={ort.id} value={ort.name}>
                {ort.name}
              </option>
            ))}
            {/* Ein Ort aus einem älteren Eintrag, der nicht mehr in der Liste steht */}
            {draft.location && !locations.some((ort) => ort.name === draft.location) ? (
              <option value={draft.location}>{draft.location}</option>
            ) : null}
            {darfOrteAnlegen ? <option value="__neu">+ Neuer Lagerort …</option> : null}
          </select>
        </div>
      </div>

      {legtOrtAn ? (
        <div className="card card--pad-sm" style={{ marginTop: 10 }}>
          <label htmlFor="neuer-ort">Neuer Lagerort</label>
          <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <input
              id="neuer-ort"
              autoFocus
              value={neuerOrt}
              placeholder="z.B. Vitrine, Box 3, Event"
              onChange={(e) => setNeuerOrt(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={!neuerOrt.trim()}
              onClick={() => void ortAnlegen()}
            >
              Anlegen
            </button>
            <button type="button" className="btn btn--sm" onClick={() => setLegtOrtAn(false)}>
              Abbrechen
            </button>
          </div>
        </div>
      ) : null}

      <div className="card card--pad-sm">
        <label className="checkbox" style={{ marginBottom: useOverride ? 12 : 0 }}>
          <input
            type="checkbox"
            checked={useOverride}
            onChange={(e) => {
              setUseOverride(e.target.checked);
              if (!e.target.checked) patch({ ruleOverride: undefined });
            }}
          />
          Eigene Preisregel nur für diesen Eintrag
        </label>
        {useOverride ? (
          <div className="field-row">
            <div>
              <label htmlFor="ov-basis">Preisbasis</label>
              <select
                id="ov-basis"
                value={draft.ruleOverride?.basis ?? ''}
                onChange={(e) =>
                  patch({
                    ruleOverride: {
                      ...draft.ruleOverride,
                      basis: e.target.value ? (e.target.value as (typeof PRICE_BASES)[number]) : undefined,
                    },
                  })
                }
              >
                <option value="">(Standard)</option>
                {PRICE_BASES.map((basis) => (
                  <option key={basis} value={basis}>
                    {PRICE_BASIS_LABELS[basis]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ov-markup">Aufschlag %</label>
              <input
                id="ov-markup"
                type="number"
                step="0.5"
                value={draft.ruleOverride?.markupPercent ?? ''}
                placeholder="Standard"
                onChange={(e) =>
                  patch({
                    ruleOverride: {
                      ...draft.ruleOverride,
                      markupPercent: e.target.value === '' ? undefined : Number(e.target.value),
                    },
                  })
                }
              />
            </div>
          </div>
        ) : null}
      </div>

      <PhotoInput photoId={draft.photoId} onChange={(photoId) => patch({ photoId })} />

      <div>
        <label htmlFor="note">Notiz</label>
        <textarea id="note" value={draft.note ?? ''} onChange={(e) => patch({ note: e.target.value })} />
      </div>

      <div className="card card--pad-sm">
        <div className="card__title" style={{ marginBottom: 8 }}>
          Preisvorschau
          <span className="badge">{preview.ruleSource === 'global' ? 'Globale Regel' : `Regel: ${preview.ruleSource}`}</span>
        </div>
        {preview.sellPrice === null ? (
          <p className="notice notice--warn" style={{ margin: 0 }}>
            {!hasPriceList ? (
              <>
                Noch keine Preisliste für {game?.name ?? 'dieses Spiel'} geladen.{' '}
                <Link to="/preise" onClick={onClose}>
                  Unter „Preise" aktualisieren
                </Link>{' '}
                – danach rechnet die App den Verkaufspreis. Bis dahin könnt ihr oben einen Fixpreis eintragen.
              </>
            ) : matchedEntry ? (
              <>
                Cardmarket führt für „{matchedEntry.name}" derzeit keinen Preis
                {draft.foil ? ' in Foil' : ''} – das kommt bei selten gehandelten Karten vor. Bitte oben einen
                Fixpreis eintragen.
              </>
            ) : (
              <>
                Diese Karte steht nicht in der Preisliste. Tipp: den Namen aus der Vorschlagsliste wählen, dann
                passt die Schreibweise. Alternativ oben einen Fixpreis eintragen.
              </>
            )}
          </p>
        ) : (
          <dl className="kv">
            <dt>
              Basis ({PRICE_BASIS_LABELS[preview.basis]})
              {settings.applyConditionFactors ? <span className="dim"> – gilt für NM</span> : null}
            </dt>
            <dd>{formatMoney(preview.basePrice, settings)}</dd>
            <dt>Aufschlag</dt>
            <dd>+{preview.markupPercent} %</dd>
            {settings.applyConditionFactors ? (
              <>
                <dt>Zustandsfaktor {draft.condition}</dt>
                <dd>
                  ×{preview.conditionFactor.toFixed(2)}
                  <span className="dim small"> ({settings.conditionFactors[draft.condition]} %)</span>
                </dd>
              </>
            ) : null}
            <dt>Verkaufspreis pro Stück</dt>
            <dd>
              <strong>{formatMoney(preview.sellPrice, settings)}</strong>
            </dd>
            <dt>Gesamt ({draft.quantity} Stk.)</dt>
            <dd>{formatMoney(preview.sellPrice * draft.quantity, settings)}</dd>
          </dl>
        )}

        {settings.applyConditionFactors && draft.condition !== 'NM' && preview.sellPrice !== null ? (
          <p className="small dim" style={{ marginTop: 10, marginBottom: 0 }}>
            Cardmarket führt je Karte nur einen Marktpreis, nicht einen je Zustand – die Basis bleibt deshalb
            gleich. Der Zustand wirkt als Faktor darauf.
          </p>
        ) : null}

        {/* Cardmarket-Preise beziehen sich auf Near-Mint-Ware. Ohne Zustands-
            faktoren bekommt eine gespielte Karte denselben Preis wie eine
            makellose – darauf sollte die App hinweisen, statt es zu verschweigen. */}
        {!settings.applyConditionFactors && draft.condition !== 'NM' && draft.condition !== 'MT' ? (
          <p className="notice notice--warn" style={{ marginTop: 10, marginBottom: 0 }}>
            Der Zustand <strong>{draft.condition}</strong> wird derzeit nicht eingerechnet – die
            Cardmarket-Preise gelten für Near Mint. Einschalten unter{' '}
            <Link to="/regeln" onClick={onClose}>
              Regeln → Zustandsfaktoren
            </Link>{' '}
            (Vorschlag: EX 85 %, GD 70 %, LP 60 %, PL 45 %, PO 30 %).
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
