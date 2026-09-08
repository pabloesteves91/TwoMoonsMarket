import {
  PRICE_BASES,
  PRICE_BASIS_LABELS,
  ROUNDINGS,
  ROUNDING_LABELS,
  type PricingRule,
  type PricingRuleOverride,
} from '../types';

interface RuleEditorProps {
  value: PricingRule | PricingRuleOverride;
  onChange: (rule: PricingRuleOverride) => void;
  /** Bei Overrides bleiben leere Felder = "Standard übernehmen" */
  optional?: boolean;
  idPrefix: string;
}

export default function RuleEditor({ value, onChange, optional = false, idPrefix }: RuleEditorProps) {
  const placeholder = optional ? '(Standard)' : '';

  return (
    <div className="field-row">
      <div>
        <label htmlFor={`${idPrefix}-basis`}>Preisbasis</label>
        <select
          id={`${idPrefix}-basis`}
          value={value.basis ?? ''}
          onChange={(e) => onChange({ ...value, basis: (e.target.value || undefined) as PricingRule['basis'] })}
        >
          {optional ? <option value="">{placeholder}</option> : null}
          {PRICE_BASES.map((basis) => (
            <option key={basis} value={basis}>
              {PRICE_BASIS_LABELS[basis]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-markup`}>Aufschlag %</label>
        <input
          id={`${idPrefix}-markup`}
          type="number"
          step="0.5"
          placeholder={placeholder}
          value={value.markupPercent ?? ''}
          onChange={(e) =>
            onChange({ ...value, markupPercent: e.target.value === '' ? undefined : Number(e.target.value) })
          }
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-min`}>Mindestpreis (EUR)</label>
        <input
          id={`${idPrefix}-min`}
          type="number"
          step="0.05"
          min={0}
          placeholder={placeholder}
          value={value.minPrice ?? ''}
          onChange={(e) => onChange({ ...value, minPrice: e.target.value === '' ? undefined : Number(e.target.value) })}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-rounding`}>Rundung</label>
        <select
          id={`${idPrefix}-rounding`}
          value={value.rounding ?? ''}
          onChange={(e) => onChange({ ...value, rounding: (e.target.value || undefined) as PricingRule['rounding'] })}
        >
          {optional ? <option value="">{placeholder}</option> : null}
          {ROUNDINGS.map((rounding) => (
            <option key={rounding} value={rounding}>
              {ROUNDING_LABELS[rounding]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
