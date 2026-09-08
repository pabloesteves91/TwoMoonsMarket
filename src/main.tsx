import { StrictMode, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { StoreProvider } from './store';
import { setRepository } from './db';
import { loadFirebaseConfig } from './firebase/env';
import './index.css';

/**
 * Startet die App. Findet sich eine Firebase-Konfiguration (.env.local oder
 * automatisch von Firebase Hosting), werden Firestore-Repository und
 * Login-Screen nachgeladen; sonst läuft alles lokal in der IndexedDB – und das
 * Firebase-SDK bleibt komplett aussen vor.
 */
/** Auf einer Firebase-Domain ohne Konfiguration liefe die App still im Einzelplatz-Modus weiter. */
function isFirebaseHost(): boolean {
  return /\.(web\.app|firebaseapp\.com)$/.test(window.location.hostname);
}

async function bootstrap() {
  let Gate: ComponentType<{ children: ReactNode }> = ({ children }) => <>{children}</>;
  const config = await loadFirebaseConfig();

  if (!config && isFirebaseHost()) {
    createRoot(document.getElementById('root')!).render(
      <div className="auth">
        <div className="auth__card">
          <h1 style={{ fontSize: 19 }}>Konfiguration fehlt</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Die App läuft auf Firebase Hosting, findet aber keine Firebase-Konfiguration. In der
            Firebase-Konsole unter <em>Projekteinstellungen → Meine Apps</em> eine Web-App registrieren
            (Symbol <span className="mono">&lt;/&gt;</span>) und danach neu veröffentlichen.
          </p>
        </div>
      </div>,
    );
    return;
  }

  if (config) {
    const [{ firebaseRepository }, { default: AuthGate }] = await Promise.all([
      import('./firebase/firebaseRepository'),
      import('./firebase/AuthGate'),
    ]);
    setRepository(firebaseRepository);
    Gate = AuthGate;
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {/* HashRouter, damit die App auch ohne Server-Rewrites (statisches Hosting) läuft */}
      <HashRouter>
        <Gate>
          <StoreProvider>
            <App />
          </StoreProvider>
        </Gate>
      </HashRouter>
    </StrictMode>,
  );
}

void bootstrap();
