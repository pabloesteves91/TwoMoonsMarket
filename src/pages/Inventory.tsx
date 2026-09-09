import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ItemForm from '../components/ItemForm';
import SellForm from '../components/SellForm';
import { isStoreOnly, useAuth } from '../firebase/authContext';
import { useStore, type PricedItem } from '../store';
import { formatMoney, formatNumber, downloadFile } from '../lib/format';
import { buildInventoryCsv, EXPORT_LABELS, type ExportFormat } from '../lib/exporters';
import { CONDITIONS, type InventoryItem } from '../types';
import { repo } from '../db';
import { numberKey } from '../lib/pricing';

type SortKey = 'name' | 'set' | 'quantity' | 'price' | 'total' | 'margin' | 'updated';

export default function Inventory() {
  const { pricedItems, settings, games, gameById, saveItem, refresh, locations, moveItems } = useStore();
  /**
   * Umlagern: vor einem Event wandern Karten in den Lagerort "Event" und
   * danach zurück. Einzeln über das Formular wären das Dutzende Handgriffe,
   * deshalb hier mehrere auf einmal. Auch das Verkaufskonto darf das – es
   * wählt aus der Liste, anlegen darf es keine Orte.
   */
  const [umlagern, setUmlagern] = useState(false);
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<string>>(new Set());
  const [zielOrt, setZielOrt] = useState('');
  const [verschiebt, setVerschiebt] = useState(false);
  const { member } = useAuth();
  /** Verkaufskonto: keine Einkaufszahlen, kein Anlegen, kein Bearbeiten. */
  const storeOnly = isStoreOnly(member);
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [gameFilter, setGameFilter] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');
  const [foilFilter, setFoilFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'total', dir: 'desc' });
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [selling, setSelling] = useState<PricedItem | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});

  const onlyUnpriced = params.get('filter') === 'unpriced';

  // Thumbnails der sichtbaren Einträge nachladen
  useEffect(() => {
    const ids = pricedItems.map((row) => row.item.photoId).filter((id): id is string => Boolean(id));
    const missing = ids.filter((id) => !(id in photos));
    if (missing.length === 0) return;
    void Promise.all(missing.map((id) => repo.getPhoto(id))).then((loaded) => {
      const next: Record<string, string> = {};
      loaded.forEach((photo) => {
        if (photo) next[photo.id] = photo.dataUrl;
      });
      if (Object.keys(next).length) setPhotos((prev) => ({ ...prev, ...next }));
    });
  }, [pricedItems, photos]);

  function umschalten(id: string) {
    setAusgewaehlt((vorher) => {
      const naechste = new Set(vorher);
      if (naechste.has(id)) naechste.delete(id);
      else naechste.add(id);
      return naechste;
    });
  }

  function beenden() {
    setUmlagern(false);
    setAusgewaehlt(new Set());
    setZielOrt('');
  }

  /** Alle gerade sichtbaren Zeilen an- oder abwählen. */
  function alleWaehlen() {
    setAusgewaehlt((vorher) =>
      vorher.size === rows.length ? new Set() : new Set(rows.map((row) => row.item.id)),
    );
  }

  async function verschieben() {
    setVerschiebt(true);
    try {
      await moveItems([...ausgewaehlt], zielOrt === '__leer' ? '' : zielOrt);
      beenden();
    } finally {
      setVerschiebt(false);
    }
  }

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = pricedItems.filter(({ item, sellPrice }) => {
      // Ausverkaufte Einträge bleiben in der Datenbank – als Gedächtnis für eine
      // Rücknahme –, gehören aber nicht in die Bestandsliste.
      if (item.quantity <= 0) return false;
      if (gameFilter && item.gameId !== gameFilter) return false;
      if (conditionFilter && item.condition !== conditionFilter) return false;
      if (foilFilter === 'foil' && !item.foil) return false;
      if (foilFilter === 'normal' && item.foil) return false;
      if (onlyUnpriced && sellPrice !== null) return false;
      if (!query) return true;
      // Jedes Suchwort muss irgendwo passen – so findet "m2a 031" die Karte
      // über Set und Nummer zugleich. Die Nummer wird dabei in der
      // Vergleichsform geprüft: "031" und "31" sind dieselbe Karte.
      const felder = [item.name, item.set, item.location, item.note]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      const nummer = item.number ? numberKey(item.number) : '';
      return query
        .split(/\s+/)
        .filter(Boolean)
        .every(
          (wort) =>
            felder.some((value) => value.includes(wort)) || (nummer !== '' && numberKey(wort) === nummer),
        );
    });

    const factor = sort.dir === 'asc' ? 1 : -1;
    const value = (row: PricedItem): number | string => {
      switch (sort.key) {
        case 'name':
          return row.item.name.toLowerCase();
        case 'set':
          return (row.item.set ?? '').toLowerCase();
        case 'quantity':
          return row.item.quantity;
        case 'price':
          return row.sellPrice ?? -1;
        case 'margin':
          return row.margin ?? -Infinity;
        case 'updated':
          return row.item.updatedAt;
        default:
          return row.totalSell ?? -1;
      }
    };
    return filtered.sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * factor;
      return (av - bv) * factor;
    });
  }, [pricedItems, search, gameFilter, conditionFilter, foilFilter, onlyUnpriced, sort]);

  const totals = rows.reduce(
    (acc, row) => ({
      units: acc.units + row.item.quantity,
      sell: acc.sell + (row.totalSell ?? 0),
      cost: acc.cost + (row.totalCost ?? 0),
    }),
    { units: 0, sell: 0, cost: 0 },
  );

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  }

  function exportCsv(format: ExportFormat) {
    const csv = buildInventoryCsv(rows, settings, format);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`twomoons-bestand-${format}-${stamp}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  }

  async function changeQuantity(row: PricedItem, delta: number) {
    const quantity = Math.max(0, row.item.quantity + delta);
    if (quantity === 0) {
      if (!confirm(`"${row.item.name}" aus dem Bestand entfernen?`)) return;
    }
    await saveItem({ ...row.item, quantity: Math.max(1, quantity), updatedAt: Date.now() });
    if (quantity === 0) {
      await repo.deleteItem(row.item.id);
      await refresh();
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bestand</h1>
          <p>
            {formatNumber(totals.units)} Karten
            {storeOnly ? '' : ` · Verkaufswert ${formatMoney(totals.sell, settings)}`}
            {storeOnly || totals.cost === 0 ? '' : ` · Einkauf ${formatMoney(totals.cost, settings)}`}
          </p>
        </div>
        {storeOnly ? null : (
        <div className="page-head__actions">
          <select
            aria-label="CSV-Export"
            value=""
            onChange={(e) => {
              if (e.target.value) exportCsv(e.target.value as ExportFormat);
              e.target.value = '';
            }}
          >
            <option value="">CSV exportieren …</option>
            {Object.entries(EXPORT_LABELS).map(([format, label]) => (
              <option key={format} value={format}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            + Karte
          </button>
        </div>
        )}
      </div>

      <div className="toolbar">
        <input
          className="toolbar__search"
          placeholder="Suchen: Name, Set + Nr., Lagerort …"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={gameFilter} onChange={(e) => setGameFilter(e.target.value)} aria-label="Spiel">
          <option value="">Alle Spiele</option>
          {games.map((game) => (
            <option key={game.id} value={game.id}>
              {game.name}
            </option>
          ))}
        </select>
        <select value={conditionFilter} onChange={(e) => setConditionFilter(e.target.value)} aria-label="Zustand">
          <option value="">Alle Zustände</option>
          {CONDITIONS.map((condition) => (
            <option key={condition} value={condition}>
              {condition}
            </option>
          ))}
        </select>
        <select value={foilFilter} onChange={(e) => setFoilFilter(e.target.value)} aria-label="Foil">
          <option value="">Foil & Normal</option>
          <option value="foil">Nur Foil</option>
          <option value="normal">Nur Normal</option>
        </select>
        <button
          type="button"
          className={`btn btn--sm${onlyUnpriced ? ' btn--primary' : ''}`}
          onClick={() => {
            const next = new URLSearchParams(params);
            if (onlyUnpriced) next.delete('filter');
            else next.set('filter', 'unpriced');
            setParams(next);
          }}
        >
          Ohne Preis
        </button>
      </div>

      {/* Umlagern steht beiden Rollen offen – vor einem Event zählt Tempo,
          und ein Lagerort ist keine Preisänderung. */}
      {rows.length > 0 ? (
        <div className="toolbar" style={{ marginBottom: 12 }}>
          {umlagern ? (
            <>
              <strong>{ausgewaehlt.size} ausgewählt</strong>
              <select value={zielOrt} onChange={(e) => setZielOrt(e.target.value)} aria-label="Ziel-Lagerort">
                <option value="">Ziel wählen …</option>
                {locations.map((ort) => (
                  <option key={ort.id} value={ort.name}>
                    {ort.name}
                  </option>
                ))}
                <option value="__leer">(kein Lagerort)</option>
              </select>
              <button
                type="button"
                className="btn btn--primary"
                disabled={ausgewaehlt.size === 0 || !zielOrt || verschiebt}
                onClick={() => void verschieben()}
              >
                {verschiebt ? 'Verschiebt …' : 'Verschieben'}
              </button>
              <button type="button" className="btn" onClick={() => alleWaehlen()}>
                {ausgewaehlt.size === rows.length ? 'Auswahl aufheben' : 'Alle sichtbaren'}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => beenden()}>
                Fertig
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setUmlagern(true)}>
              Umlagern …
            </button>
          )}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty__icon">▦</div>
          <p>
            {storeOnly
              ? 'Keine Karten im Bestand, die zu den Filtern passen.'
              : pricedItems.length === 0
                ? 'Noch keine Karten erfasst. Lege den ersten Eintrag an – oder importiere zuerst die Preisliste.'
                : 'Keine Treffer für die aktuellen Filter.'}
          </p>
          {storeOnly ? null : (
            <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
              + Karte hinzufügen
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop: Tabelle */}
          <div className="table-wrap desktop-only">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 46 }}>
                    {umlagern ? (
                      <input
                        type="checkbox"
                        aria-label="Alle sichtbaren auswählen"
                        checked={ausgewaehlt.size === rows.length && rows.length > 0}
                        onChange={() => alleWaehlen()}
                      />
                    ) : null}
                  </th>
                  <th className="is-sortable" onClick={() => toggleSort('name')}>
                    Karte
                  </th>
                  <th className="is-sortable" onClick={() => toggleSort('set')}>
                    Set
                  </th>
                  <th>Details</th>
                  <th className="num is-sortable" onClick={() => toggleSort('quantity')}>
                    Menge
                  </th>
                  <th className="num is-sortable" onClick={() => toggleSort('price')}>
                    VK / Stk.
                  </th>
                  <th className="num is-sortable" onClick={() => toggleSort('total')}>
                    Gesamt
                  </th>
                  {storeOnly ? null : (
                    <th className="num is-sortable" onClick={() => toggleSort('margin')}>
                      Marge
                    </th>
                  )}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const game = gameById.get(row.item.gameId);
                  return (
                    <tr key={row.item.id} className={ausgewaehlt.has(row.item.id) ? 'is-picked' : undefined}>
                      <td>
                        {umlagern ? (
                          <input
                            type="checkbox"
                            aria-label={`${row.item.name} auswählen`}
                            checked={ausgewaehlt.has(row.item.id)}
                            onChange={() => umschalten(row.item.id)}
                          />
                        ) : row.item.photoId && photos[row.item.photoId] ? (
                          <img className="thumb" src={photos[row.item.photoId]} alt="" />
                        ) : (
                          <div className="thumb thumb--empty" aria-hidden>
                            ▦
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="cell-main">{row.item.name}</span>
                        <br />
                        <span className="cell-sub">
                          {game?.short ?? row.item.gameId}
                          {row.item.number ? ` · #${row.item.number}` : ''}
                          {row.item.location ? ` · ${row.item.location}` : ''}
                        </span>
                      </td>
                      <td className="cell-sub">{row.item.set ?? '–'}</td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          <span className="badge">{row.item.condition}</span>
                          <span className="badge">{row.item.language}</span>
                          {row.item.foil ? <span className="badge badge--foil">Foil</span> : null}
                          {row.sellPrice === null ? (
                            <span className="badge badge--warn" title={row.calc.reason}>
                              kein Preis
                            </span>
                          ) : null}
                          {row.calc.ruleSource !== 'global' ? (
                            <span className="badge" title="Abweichende Preisregel">
                              {row.calc.ruleSource === 'fixed' ? 'Fixpreis' : 'Sonderregel'}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="num">
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 4, flexWrap: 'nowrap' }}>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => void changeQuantity(row, -1)}
                            aria-label="Menge verringern"
                          >
                            −
                          </button>
                          <span style={{ minWidth: 22, textAlign: 'center' }}>{row.item.quantity}</span>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => void changeQuantity(row, 1)}
                            aria-label="Menge erhöhen"
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td className="num">{formatMoney(row.sellPrice, settings, { showCode: false })}</td>
                      <td className="num">{formatMoney(row.totalSell, settings, { showCode: false })}</td>
                      {storeOnly ? null : (
                        <td className={`num ${row.margin === null ? '' : row.margin >= 0 ? 'pos' : 'neg'}`}>
                          {row.margin === null ? '–' : formatMoney(row.margin, settings, { showCode: false })}
                        </td>
                      )}
                      <td className="num">
                        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <button type="button" className="btn btn--sm" onClick={() => setSelling(row)}>
                            Verkauft
                          </button>
                          {storeOnly ? null : (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => setEditing(row.item)}
                            >
                              Bearbeiten
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: Karten */}
          <div className="item-list mobile-only">
            {rows.map((row) => (
              <div
                key={row.item.id}
                className={`item-card${umlagern && ausgewaehlt.has(row.item.id) ? ' is-picked' : ''}`}
                onClick={() =>
                  umlagern
                    ? umschalten(row.item.id)
                    : storeOnly
                      ? setSelling(row)
                      : setEditing(row.item)
                }
              >
                {row.item.photoId && photos[row.item.photoId] ? (
                  <img className="thumb" src={photos[row.item.photoId]} alt="" />
                ) : (
                  <div className="thumb thumb--empty" aria-hidden>
                    ▦
                  </div>
                )}
                <span>
                  <span className="cell-main">{row.item.name}</span>
                  <br />
                  <span className="cell-sub">{row.item.set ?? 'ohne Set'}</span>
                  <span className="item-card__meta">
                    <span className="badge">{row.item.condition}</span>
                    <span className="badge">{row.item.language}</span>
                    {row.item.foil ? <span className="badge badge--foil">Foil</span> : null}
                    <span className="badge">{row.item.quantity}×</span>
                    {row.sellPrice === null ? <span className="badge badge--warn">kein Preis</span> : null}
                  </span>
                </span>
                <span className="item-card__price">
                  <strong>{formatMoney(row.sellPrice, settings, { showCode: false })}</strong>
                  <span className="cell-sub">{formatMoney(row.totalSell, settings)}</span>
                  <button
                    type="button"
                    className="btn btn--sm"
                    style={{ marginTop: 6 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelling(row);
                    }}
                  >
                    Verkauft
                  </button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {selling ? <SellForm row={selling} onClose={() => setSelling(null)} /> : null}
      {creating ? <ItemForm onClose={() => setCreating(false)} /> : null}
      {editing ? <ItemForm item={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
