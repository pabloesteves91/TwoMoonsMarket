import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Prices from './pages/Prices';
import Approvals from './pages/Approvals';
import Rules from './pages/Rules';
import SettingsPage from './pages/Settings';
import { useStore } from './store';
import { formatNumber } from './lib/format';
import { useAuth } from './firebase/authContext';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◑', end: true },
  { to: '/bestand', label: 'Bestand', icon: '▦', end: false },
  { to: '/preise', label: 'Preise', icon: '€', end: false },
  { to: '/freigabe', label: 'Freigabe', icon: '✓', end: false },
  { to: '/regeln', label: 'Regeln', icon: '%', end: false },
  { to: '/einstellungen', label: 'Einstellungen', icon: '⚙', end: false },
];

export default function App() {
  const { items, priceStats, settings, pricedItems } = useStore();
  const { user, signOut } = useAuth();
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
          {NAV.map((entry) => (
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
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/bestand" element={<Inventory />} />
          <Route path="/preise" element={<Prices />} />
          <Route path="/freigabe" element={<Approvals />} />
          <Route path="/regeln" element={<Rules />} />
          <Route path="/einstellungen" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="tabbar">
        {NAV.map((entry) => (
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
