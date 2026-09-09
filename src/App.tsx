import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Prices from './pages/Prices';
import Approvals from './pages/Approvals';
import Sales from './pages/Sales';
import Rules from './pages/Rules';
import SettingsPage from './pages/Settings';
import { useStore } from './store';
import { formatNumber } from './lib/format';
import { isStoreOnly, useAuth } from './firebase/authContext';

/** Täglich gebraucht – diese stehen am Handy in der Leiste unten. */
const NAV = [
  { to: '/', label: 'Dashboard', icon: '◑', end: true },
  { to: '/bestand', label: 'Bestand', icon: '▦', end: false },
  { to: '/verkaeufe', label: 'Verkäufe', icon: '↗', end: false },
  { to: '/preise', label: 'Preise', icon: '€', end: false },
  { to: '/freigabe', label: 'Freigabe', icon: '✓', end: false },
];

/** Einstellungssachen – am Handy oben in der Kopfzeile. */
const CONFIG_NAV = [
  { to: '/regeln', label: 'Regeln', icon: '%', end: false },
  { to: '/einstellungen', label: 'Einstellungen', icon: '⚙', end: false },
];

export default function App() {
  const { items, priceStats, settings, pricedItems, priceSync, priceSyncError } = useStore();
  const { user, member, signOut } = useAuth();
  /**
   * Verkaufskonto: sieht nur Bestand und die eigenen Verkäufe des Tages.
   * Die Sperre in der Oberfläche ist die Bequemlichkeit; verbindlich sind die
   * Security Rules in firestore.rules.
   */
  const storeOnly = isStoreOnly(member);
  const nav = storeOnly ? NAV.filter((entry) => entry.to === '/bestand' || entry.to === '/verkaeufe') : NAV;
  const configNav = storeOnly ? [] : CONFIG_NAV;
  const priceCount = priceStats.reduce((sum, s) => sum + s.count, 0);
  const pending = pricedItems.filter((row) => row.needsApproval).length;
  const badges: Record<string, string> = {
    '/bestand': formatNumber(items.reduce((sum, i) => sum + i.quantity, 0)),
    '/preise': formatNumber(priceCount),
    ...(pending > 0 ? { '/freigabe': formatNumber(pending) } : {}),
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <span className="brand__mark">◑◐</span>
          <span>
            <span className="brand__name">TwoMoons Market</span>
            <br />
            <span className="brand__sub">TCG Collector</span>
          </span>
        </NavLink>

        <nav className="nav">
          {[...nav, ...configNav].map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              end={entry.end}
              className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`}
            >
              <span className="nav__icon" aria-hidden>
                {entry.icon}
              </span>
              {entry.label}
              {badges[entry.to] ? <span className="nav__badge">{badges[entry.to]}</span> : null}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__foot">
          <span>{settings.companyName}</span>
          <span>Anzeige in {settings.currency}</span>
          {user ? (
            <>
              <span title={user.email ?? undefined}>{user.email}</span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                style={{ justifySelf: 'start', paddingInline: 0 }}
                onClick={() => void signOut()}
              >
                Abmelden
              </button>
            </>
          ) : null}
        </div>
      </aside>

      <header className="mobile-bar">
        <NavLink to="/" className="brand">
          <span className="brand__mark">◑◐</span>
          <span className="brand__name">TwoMoons Market</span>
        </NavLink>
        <span className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
          {configNav.map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              className={({ isActive }) => `btn btn--ghost btn--sm${isActive ? ' is-active' : ''}`}
              aria-label={entry.label}
              title={entry.label}
            >
              {entry.icon}
            </NavLink>
          ))}
        </span>
      </header>

      <main className="main">
        {priceSync ? (
          <p className="sync" role="status">
            <span className="sync__dot" aria-hidden />
            Preise werden aktualisiert –{' '}
            {priceSync.phase === 'download'
              ? 'wird geladen'
              : priceSync.phase === 'parse'
                ? 'wird gelesen'
                : 'wird gespeichert'}{' '}
            ({Math.min(priceSync.index + 1, priceSync.total)}/{priceSync.total}). Die App ist währenddessen benutzbar.
          </p>
        ) : priceSyncError ? (
          <p className="notice notice--warn" role="status">
            {priceSyncError}{' '}
            <Link to="/preise">Preise von Hand laden</Link>
          </p>
        ) : null}

        {/* Beim Verkaufskonto führen auch von Hand eingetippte Adressen nur
            auf Bestand und die eigenen Verkäufe. */}
        {storeOnly ? (
          <Routes>
            <Route path="/bestand" element={<Inventory />} />
            <Route path="/verkaeufe" element={<Sales />} />
            <Route path="*" element={<Navigate to="/bestand" replace />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/bestand" element={<Inventory />} />
            <Route path="/preise" element={<Prices />} />
            <Route path="/freigabe" element={<Approvals />} />
            <Route path="/verkaeufe" element={<Sales />} />
            <Route path="/regeln" element={<Rules />} />
            <Route path="/einstellungen" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>

      <nav className="tabbar">
        {nav.map((entry) => (
          <NavLink
            key={entry.to}
            to={entry.to}
            end={entry.end}
            className={({ isActive }) => `tabbar__link${isActive ? ' is-active' : ''}`}
          >
            <span className="tabbar__icon" aria-hidden>
              {entry.icon}
            </span>
            {entry.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
