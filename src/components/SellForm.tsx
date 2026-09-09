import { useState } from 'react';
import Modal from './Modal';
import { useStore, type PricedItem } from '../store';
import { useAuth } from '../firebase/authContext';
import { convert, formatMoney, uid } from '../lib/format';
import { SALE_CHANNELS, SALE_CHANNEL_LABELS, type Sale, type SaleChannel } from '../types';

/** Bucht einen Verkauf für einen Bestandseintrag. */
export default function SellForm({ row, onClose }: { row: PricedItem; onClose: () => void }) {
  const { settings, recordSale } = useStore();
  // Wer gebucht hat, entscheidet später, wer stornieren darf
  const { user } = useAuth();
  const suggested = row.approvedPrice ?? row.calc.sellPrice ?? 0;

  const [quantity, setQuantity] = useState(1);
  // Eingabe in der Anzeigewährung, gespeichert wird in EUR
  const [price, setPrice] = useState(() => convert(suggested, settings).toFixed(2));
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [channel, setChannel] = useState<SaleChannel>('laden');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unitPriceEur =
    settings.currency === 'CHF' && settings.eurToChf > 0
      ? Number(price) / settings.eurToChf
      : Number(price);
  const totalEur = unitPriceEur * quantity;
  const profitEur =
    row.item.purchasePrice === undefined ? null : (unitPriceEur - row.item.purchasePrice) * quantity;

  async function submit() {
    if (quantity < 1 || quantity > row.item.quantity) {
      setError(`Menge muss zwischen 1 und ${row.item.quantity} liegen.`);
      return;
    }
    if (!Number.isFinite(unitPriceEur) || unitPriceEur <= 0) {
      setError('Bitte einen Verkaufspreis eingeben.');
      return;
    }
    setBusy(true);
    try {
      const sale: Sale = {
        id: uid('sale_'),
        itemId: row.item.id,
        gameId: row.item.gameId,
        name: row.item.name,
        set: row.item.set,
        condition: row.item.condition,
        language: row.item.language,
        foil: row.item.foil,
        quantity,
        unitPrice: Math.round(unitPriceEur * 100) / 100,
        purchasePrice: row.item.purchasePrice,
        soldAt: new Date(`${date}T12:00:00`).getTime(),
        channel,
        note: note.trim() || undefined,
        createdAt: Date.now(),
        soldBy: user?.uid,
        soldByEmail: user?.email ?? undefined,
      };
      await recordSale(sale);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Verkauf buchen"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Bucht …' : 'Verkauf buchen'}
          </button>
        </>
      }
    >
      {error ? <p className="notice notice--error">{error}</p> : null}

      <div className="card card--pad-sm">
        <span className="cell-main">{row.item.name}</span>
        <br />
        <span className="cell-sub">
          {row.item.set ?? 'ohne Set'} · {row.item.condition} · {row.item.language}
          {row.item.foil ? ' · Foil' : ''} · {row.item.quantity} auf Lager
        </span>
      </div>

      <div className="field-row">
        <div>
          <label htmlFor="sell-qty">Menge</label>
          <input
            id="sell-qty"
            type="number"
            min={1}
            max={row.item.quantity}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </div>
        <div>
          <label htmlFor="sell-price">Preis pro Stück ({settings.currency})</label>
          <input
            id="sell-price"
            type="number"
            step="0.05"
            min={0}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="sell-date">Datum</label>
          <input id="sell-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className="field-row">
        <div>
          <label htmlFor="sell-channel">Wo verkauft</label>
          <select id="sell-channel" value={channel} onChange={(e) => setChannel(e.target.value as SaleChannel)}>
            {SALE_CHANNELS.map((entry) => (
              <option key={entry} value={entry}>
                {SALE_CHANNEL_LABELS[entry]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sell-note">Notiz</label>
          <input
            id="sell-note"
            value={note}
            placeholder="z.B. Stammkunde, Tauschgeschäft"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      <dl className="kv">
        <dt>Vorschlag (Kärtchenpreis)</dt>
        <dd>{formatMoney(suggested, settings)}</dd>
        <dt>Erlös</dt>
        <dd>
          <strong>{formatMoney(totalEur, settings)}</strong>
        </dd>
        {profitEur !== null ? (
          <>
            <dt>Gewinn</dt>
            <dd className={profitEur >= 0 ? 'pos' : 'neg'}>{formatMoney(profitEur, settings)}</dd>
          </>
        ) : null}
        <dt>Rest auf Lager</dt>
        <dd>{Math.max(0, row.item.quantity - quantity)}</dd>
      </dl>
    </Modal>
  );
}
