import { StrictMode, Component, useState, useEffect } from 'react';
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

/* ── Error Boundary ── */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[Application ErrorBoundary caught]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-box" role="alert">
          <h2>An unexpected error occurred</h2>
          <p>{this.state.error?.message || 'Something went wrong while rendering this view.'}</p>
          <button
            type="button"
            className="rc-btn-primary"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Global Toast Helper & Component ── */
export const showToast = (message, type = 'info') => {
  window.dispatchEvent(new CustomEvent('app:toast', { detail: { message, type, id: Date.now() } }));
};

function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handleToast = (e) => {
      const toast = e.detail;
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 4000);
    };

    window.addEventListener('app:toast', handleToast);
    return () => window.removeEventListener('app:toast', handleToast);
  }, []);

  if (!toasts.length) return null;

  return (
    <div className="toast-container" aria-live="polite" aria-atomic="true">
      {toasts.map((t) => (
        <div key={t.id} className={`toast-item toast-item--${t.type}`} role="status">
          <span>{t.message}</span>
          <button
            type="button"
            className="toast-close-btn"
            onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── Role badge color ── */
const roleBadge = (role) =>
  role === 'admin' ? 'badge-admin' : 'badge-user';

function App() {
  const [tab, setTab]   = useState('monitor');
  const [user, setUser] = useState(null);    // null = loading, false = not logged in
  const [authChecked, setAuthChecked] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('portal_theme') || 'auto');

  /* Apply and persist theme */
  useEffect(() => {
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('portal_theme', 'auto');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('portal_theme', theme);
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((current) => {
      if (current === 'auto') return 'dark';
      if (current === 'dark') return 'light';
      return 'auto';
    });
  };

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
      <div className="auth-loading" role="status">
        <div className="auth-loading-spinner" />
        <p>Checking session…</p>
      </div>
    );
  }

  /* Not logged in → show Login page */
  if (!user) {
    return (
      <>
        <LoginPage onLogin={(u) => setUser(u)} />
        <ToastContainer />
      </>
    );
  }

  const themeIcon = theme === 'dark' ? '🌙 Dark' : theme === 'light' ? '☀️ Light' : '💻 Auto';

  /* Logged in → show the app */
  return (
    <>
      {/* ── Top App Bar ── */}
      <header className="app-header" role="banner">
        <div className="app-header-brand">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="app-header-logo">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          <span className="app-header-name">Report Portal</span>
        </div>

        {/* Tab bar (centered) */}
        <nav className="app-tabs" role="tablist" aria-label="Portal Navigation">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              className={`app-tab ${tab === t.id ? 'app-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* User info + Theme toggle + logout */}
        <div className="app-header-user">
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title={`Current theme: ${theme}. Click to switch.`}
            aria-label="Toggle theme color scheme"
          >
            {themeIcon}
          </button>
          <span className={`app-role-badge ${roleBadge(user.role)}`}>
            {user.role === 'admin' ? '👑' : '👤'} {user.role}
          </span>
          <span className="app-user-name" title={user.email}>{user.name}</span>
          <button className="app-logout-btn" onClick={handleLogout} title="Sign out" aria-label="Sign out">
            Sign out
          </button>
        </div>
      </header>

      {/* ── Active view wrapped in ErrorBoundary ── */}
      <main id={`panel-${tab}`} role="tabpanel">
        <ErrorBoundary>
          {tab === 'monitor' && <LiveMonitor currentUser={user} />}
          {tab === 'report'  && <ReportConsole />}
        </ErrorBoundary>
      </main>

      {/* ── Global Toasts ── */}
      <ToastContainer />
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
