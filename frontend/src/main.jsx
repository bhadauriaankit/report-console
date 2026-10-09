import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import ReportConsole from './ReportConsole.jsx';
import LiveMonitor from './LiveMonitor.jsx';
import LoginPage from './LoginPage.jsx';
import { getMe, logout } from './api.js';
import './styles.css';
import './LoginPage.css';

const TABS = [
  { id: 'monitor', label: '🟢 Live Monitor' },
  { id: 'report',  label: '📊 Scaler Reports' },
];

/* ── Role badge color ── */
const roleBadge = (role) =>
  role === 'admin' ? 'badge-admin' : 'badge-user';

function App() {
  const [tab, setTab]   = useState('monitor');
  const [user, setUser] = useState(null);    // null = loading, false = not logged in
  const [authChecked, setAuthChecked] = useState(false);

  /* Check session on mount */
  useEffect(() => {
    getMe()
      .then((r) => {
        setUser(r.ok ? r.body.user : false);
      })
      .catch(() => setUser(false))
      .finally(() => setAuthChecked(true));
  }, []);

  const handleLogout = async () => {
    await logout();
    setUser(false);
  };

  /* Loading splash */
  if (!authChecked) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-spinner" />
        <p>Checking session…</p>
      </div>
    );
  }

  /* Not logged in → show Login page */
  if (!user) {
    return <LoginPage onLogin={(u) => setUser(u)} />;
  }

  /* Logged in → show the app */
  return (
    <>
      {/* ── Top App Bar ── */}
      <header className="app-header">
        <div className="app-header-brand">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="app-header-logo">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          <span className="app-header-name">Report Portal</span>
        </div>

        {/* Tab bar (centered) */}
        <nav className="app-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`app-tab ${tab === t.id ? 'app-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* User info + logout */}
        <div className="app-header-user">
          <span className={`app-role-badge ${roleBadge(user.role)}`}>
            {user.role === 'admin' ? '👑' : '👤'} {user.role}
          </span>
          <span className="app-user-name" title={user.email}>{user.name}</span>
          <button className="app-logout-btn" onClick={handleLogout} title="Sign out">
            Sign out
          </button>
        </div>
      </header>

      {/* ── Active view ── */}
      {tab === 'monitor' && <LiveMonitor />}
      {tab === 'report'  && <ReportConsole />}
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
