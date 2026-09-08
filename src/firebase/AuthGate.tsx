import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { authErrorMessage, getDb, getFirebaseAuth } from './config';
import { WORKSPACE_ID } from './env';
import { AuthContext, type AuthValue, type Member } from './authContext';

type State =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'noAccess'; user: User }
  | { status: 'ready'; user: User; member: Member };

/**
 * Schützt die App, wenn Firebase konfiguriert ist: ohne Anmeldung erscheint der
 * Login-Screen, ohne Freischaltung im Arbeitsbereich ein Hinweis mit der eigenen
 * Benutzer-ID zum Weitergeben an die Administration.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  const checkMembership = useCallback(async (user: User) => {
    try {
      const snapshot = await getDoc(doc(getDb(), 'workspaces', WORKSPACE_ID, 'members', user.uid));
      if (snapshot.exists()) setState({ status: 'ready', user, member: snapshot.data() as Member });
      else setState({ status: 'noAccess', user });
    } catch {
      // Die Security Rules verweigern den Zugriff, wenn kein Mitglieds-Dokument existiert
      setState({ status: 'noAccess', user });
    }
  }, []);

  useEffect(() => {
    return onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (!user) setState({ status: 'signedOut' });
      else void checkMembership(user);
    });
  }, [checkMembership]);

  const value = useMemo<AuthValue>(
    () => ({
      user:
        state.status === 'ready' || state.status === 'noAccess'
          ? { uid: state.user.uid, email: state.user.email }
          : null,
      member: state.status === 'ready' ? state.member : null,
      signOut: () => signOut(getFirebaseAuth()),
    }),
    [state],
  );

  if (state.status === 'loading') {
    return (
      <div className="boot">
        <div className="boot__logo">◑◐</div>
        <p>Anmeldung wird geprüft …</p>
      </div>
    );
  }

  if (state.status === 'signedOut') return <LoginScreen />;
  if (state.status === 'noAccess') return <NoAccessScreen user={state.user} onSignOut={value.signOut} />;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
    } catch (err) {
      setError(authErrorMessage((err as { code?: string }).code ?? 'auth/unknown'));
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setError('Bitte zuerst die E-Mail-Adresse eingeben.');
      return;
    }
    setError(null);
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
      setInfo('E-Mail zum Zurücksetzen des Passworts wurde verschickt.');
    } catch (err) {
      setError(authErrorMessage((err as { code?: string }).code ?? 'auth/unknown'));
    }
  }

  return (
    <div className="auth">
      <form className="auth__card" onSubmit={submit}>
        <div className="auth__brand">
          <span className="brand__mark">◑◐</span>
          <div>
            <div className="brand__name">TwoMoons Market</div>
            <div className="brand__sub">TCG Collector</div>
          </div>
        </div>

        <h1 style={{ fontSize: 19 }}>Anmelden</h1>
        <p className="muted small" style={{ margin: 0 }}>
          Zugangsdaten erhaltet ihr von der Administration.
        </p>

        {error ? <p className="notice notice--error">{error}</p> : null}
        {info ? <p className="notice notice--ok">{info}</p> : null}

        <div>
          <label htmlFor="email">E-Mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="password">Passwort</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? 'Anmeldung läuft …' : 'Anmelden'}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void resetPassword()}>
          Passwort vergessen?
        </button>
      </form>
    </div>
  );
}

function NoAccessScreen({ user, onSignOut }: { user: User; onSignOut: () => Promise<void> }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <span className="brand__mark">◑◐</span>
          <div>
            <div className="brand__name">TwoMoons Market</div>
            <div className="brand__sub">TCG Collector</div>
          </div>
        </div>
        <h1 style={{ fontSize: 19 }}>Noch nicht freigeschaltet</h1>
        <p className="muted small" style={{ margin: 0 }}>
          Die Anmeldung hat geklappt, dieses Konto ist aber noch nicht für den Arbeitsbereich{' '}
          <span className="mono">{WORKSPACE_ID}</span> freigegeben. Bitte die folgende Benutzer-ID an die
          Administration weitergeben.
        </p>
        <dl className="kv">
          <dt>E-Mail</dt>
          <dd>{user.email}</dd>
          <dt>Benutzer-ID</dt>
          <dd className="mono">{user.uid}</dd>
        </dl>
        <button
          type="button"
          className="btn btn--block"
          onClick={() => {
            void navigator.clipboard?.writeText(user.uid).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? 'Kopiert' : 'Benutzer-ID kopieren'}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void onSignOut()}>
          Abmelden
        </button>
      </div>
    </div>
  );
}
