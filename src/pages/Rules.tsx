import { useMemo, useState } from 'react';
import Modal from '../components/Modal';
import RuleEditor from '../components/RuleEditor';
import { useStore } from '../store';
import { formatMoney } from '../lib/format';
import { roundPrice, setOverrideId } from '../lib/pricing';
import { PRICE_BASIS_LABELS, type PricingRule, type RuleOverride, type Settings } from '../types';
import { uid } from '../lib/format';

/** Beispielrechnung, damit die Wirkung einer Regel sofort sichtbar ist. */
function example(rule: PricingRule, base: number): number {
  return Math.max(roundPrice(base * (1 + rule.markupPercent / 100), rule.rounding), rule.minPrice);
}

export default function Rules() {
  const { settings, saveSettings, overrides, saveOverride, deleteOverride, games, items } = useStore();
  const [draft, setDraft] = useState<Settings>(settings);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<RuleOverride | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  // Sets aus dem Bestand als Vorschläge für Set-Regeln
  const knownSets = useMemo(() => {
    const sets = new Map<string, { gameId: string; label: string }>();
    for (const item of items) {
      if (!item.set) continue;
      sets.set(setOverrideId(item.gameId, item.set), { gameId: item.gameId, label: item.set });
    }
    return [...sets.entries()].map(([id, value]) => ({ id, ...value }));
  }, [items]);

  async function persist() {
    await saveSettings(draft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Preisregeln</h1>
          <p>
            Der Verkaufspreis entsteht aus einer Cardmarket-Preisspalte plus Aufschlag. Foil und Non-Foil haben
            eigene Regeln; Set- und Karten-Regeln übersteuern die globalen Werte.
          </p>
        </div>
        <div className="page-head__actions">
          {saved ? <span className="badge badge--ok">Gespeichert</span> : null}
          <button type="button" className="btn btn--primary" disabled={!dirty} onClick={() => void persist()}>
            Speichern
          </button>
        </div>
      </div>

      <div className="grid grid--two">
        <div className="card">
          <div className="card__title">Standard · Non-Foil</div>
          <RuleEditor
            idPrefix="nonfoil"
            value={draft.nonFoil}
            onChange={(rule) => setDraft({ ...draft, nonFoil: { ...draft.nonFoil, ...rule } })}
          />
          <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
            Beispiel: Basis 10.00 EUR → Verkauf{' '}
            <strong>{formatMoney(example(draft.nonFoil, 10), draft)}</strong> · Basis 0.15 EUR →{' '}
            <strong>{formatMoney(example(draft.nonFoil, 0.15), draft)}</strong>
          </p>
        </div>

        <div className="card">
          <div className="card__title">
            Standard · Foil <span className="badge badge--foil">Foil</span>
          </div>
          <RuleEditor
            idPrefix="foil"
            value={draft.foil}
            onChange={(rule) => setDraft({ ...draft, foil: { ...draft.foil, ...rule } })}
          />
          <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
            Beispiel: Basis 10.00 EUR → Verkauf{' '}
            <strong>{formatMoney(example(draft.foil, 10), draft)}</strong> · Basis 0.15 EUR →{' '}
            <strong>{formatMoney(example(draft.foil, 0.15), draft)}</strong>
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__title">Zustandsfaktoren</div>
        <p className="card__hint">
          Die Cardmarket-Preisliste kennt keine Preise je Zustand – die Angaben gelten für Near-Mint-Ware.
          Mit diesen Faktoren bekommt eine gespielte Karte automatisch einen entsprechend tieferen Preis.
          Ohne sie kostet eine PO-Karte gleich viel wie eine makellose.
        </p>
        <label className="checkbox" style={{ marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={draft.applyConditionFactors}
            onChange={(e) => setDraft({ ...draft, applyConditionFactors: e.target.checked })}
          />
          Zustandsfaktoren anwenden
        </label>

        {draft.applyConditionFactors ? (
          <p className="small muted" style={{ marginTop: 0, marginBottom: 12 }}>
            Beispiel bei einem Trend-Preis von 10.00 EUR:{' '}
            {(['NM', 'EX', 'GD', 'LP'] as const)
              .map(
                (condition) =>
                  `${condition} ${formatMoney(
                    example(draft.nonFoil, 10) * (draft.conditionFactors[condition] / 100),
                    draft,
                  )}`,
              )
              .join(' · ')}
          </p>
        ) : null}
        <div className="field-row">
          {Object.entries(draft.conditionFactors).map(([condition, factor]) => (
            <div key={condition}>
              <label htmlFor={`cf-${condition}`}>{condition} %</label>
              <input
                id={`cf-${condition}`}
                type="number"
                step="1"
                min={0}
                disabled={!draft.applyConditionFactors}
                value={factor}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    conditionFactors: {
                      ...draft.conditionFactors,
                      [condition]: Number(e.target.value),
                    } as Settings['conditionFactors'],
                  })
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__title">
          Sonderregeln für Sets und Karten
          <button
            type="button"
            className="btn btn--sm"
            onClick={() =>
              setEditing({
                id: '',
                scope: 'set',
                gameId: games[0]?.id ?? 'mtg',
                label: '',
                updatedAt: Date.now(),
              })
            }
          >
            + Regel
          </button>
        </div>
        {overrides.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            Keine Sonderregeln. Alle Karten folgen den Standardregeln oben.
          </p>
        ) : (
          <ul className="list-reset divide">
            {overrides.map((override) => (
              <li key={override.id} className="row row--between">
                <span>
                  <span className="cell-main">{override.label}</span>{' '}
                  <span className="badge">{override.scope === 'set' ? 'Set' : 'Karte'}</span>
                  <br />
                  <span className="cell-sub">
                    {(['nonFoil', 'foil'] as const)
                      .map((key) => {
                        const rule = override[key];
                        if (!rule || Object.keys(rule).length === 0) return null;
                        const parts = [
                          rule.basis ? PRICE_BASIS_LABELS[rule.basis] : null,
                          rule.markupPercent !== undefined ? `+${rule.markupPercent} %` : null,
                          rule.minPrice !== undefined ? `min ${rule.minPrice}` : null,
                          rule.rounding ? `Rundung ${rule.rounding}` : null,
                        ].filter(Boolean);
                        return `${key === 'foil' ? 'Foil' : 'Non-Foil'}: ${parts.join(', ')}`;
                      })
                      .filter(Boolean)
                      .join(' · ') || 'keine Abweichung gesetzt'}
                  </span>
                </span>
                <span className="row">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(override)}>
                    Bearbeiten
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void deleteOverride(override.id)}
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing ? (
        <OverrideModal
          override={editing}
          knownSets={knownSets}
          games={games}
          onClose={() => setEditing(null)}
          onSave={async (next) => {
            await saveOverride(next);
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

interface OverrideModalProps {
  override: RuleOverride;
  knownSets: { id: string; gameId: string; label: string }[];
  games: { id: string; name: string }[];
  onClose: () => void;
  onSave: (override: RuleOverride) => Promise<void>;
}

function OverrideModal({ override, knownSets, games, onClose, onSave }: OverrideModalProps) {
  const [draft, setDraft] = useState<RuleOverride>(override);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!draft.label.trim()) {
      setError(draft.scope === 'set' ? 'Bitte einen Set-Namen angeben.' : 'Bitte einen Kartennamen angeben.');
      return;
    }
    const id =
      draft.id ||
      (draft.scope === 'set' ? setOverrideId(draft.gameId, draft.label) : `card:${draft.gameId}:${uid()}`);
    await onSave({ ...draft, id, label: draft.label.trim(), updatedAt: Date.now() });
  }

  return (
    <Modal
      title={draft.id ? 'Sonderregel bearbeiten' : 'Neue Sonderregel'}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void submit()}>
            Speichern
          </button>
        </>
      }
    >
      {error ? <p className="notice notice--error">{error}</p> : null}
      <div className="field-row">
        <div>
          <label htmlFor="ov-scope">Gültig für</label>
          <select
            id="ov-scope"
            value={draft.scope}
            disabled={Boolean(override.id)}
            onChange={(e) => setDraft({ ...draft, scope: e.target.value as RuleOverride['scope'] })}
          >
            <option value="set">Ganzes Set</option>
            <option value="card">Einzelne Karte</option>
          </select>
        </div>
        <div>
          <label htmlFor="ov-game">Spiel</label>
          <select
            id="ov-game"
            value={draft.gameId}
            disabled={Boolean(override.id)}
            onChange={(e) => setDraft({ ...draft, gameId: e.target.value })}
          >
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="ov-label">{draft.scope === 'set' ? 'Set-Name' : 'Kartenname'}</label>
        <input
          id="ov-label"
          list="known-sets"
          value={draft.label}
          disabled={Boolean(override.id)}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        />
        <datalist id="known-sets">
          {knownSets
            .filter((set) => set.gameId === draft.gameId)
            .map((set) => (
              <option key={set.id} value={set.label} />
            ))}
        </datalist>
        <p className="small dim" style={{ marginTop: 6 }}>
          Leere Felder unten bedeuten: Standardregel übernehmen.
        </p>
      </div>

      <div className="card card--pad-sm">
        <div className="card__title" style={{ marginBottom: 10 }}>
          Non-Foil
        </div>
        <RuleEditor
          idPrefix="ov-nonfoil"
          optional
          value={draft.nonFoil ?? {}}
          onChange={(rule) => setDraft({ ...draft, nonFoil: rule })}
        />
      </div>

      <div className="card card--pad-sm">
        <div className="card__title" style={{ marginBottom: 10 }}>
          Foil
        </div>
        <RuleEditor
          idPrefix="ov-foil"
          optional
          value={draft.foil ?? {}}
          onChange={(rule) => setDraft({ ...draft, foil: rule })}
        />
      </div>
    </Modal>
  );
}
