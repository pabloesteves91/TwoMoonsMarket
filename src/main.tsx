import { StrictMode, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { StoreProvider } from './store';
import { setRepository } from './db';
import { isFirebaseEnabled } from './firebase/env';
import './index.css';

/**
 * Startet die App. Ist Firebase konfiguriert (.env.local), werden das
 * Firestore-Repository und der Login-Screen nachgeladen; sonst läuft alles
 * lokal in der IndexedDB – und das Firebase-SDK bleibt komplett aussen vor.
 */
async function bootstrap() {
  let Gate: ComponentType<{ children: ReactNode }> = ({ children }) => <>{children}</>;

  if (isFirebaseEnabled()) {
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
