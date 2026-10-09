import { useState } from 'react';
import { loginAdmin, microsoftLoginUrl } from './api.js';

/* ── Microsoft Brand Icon (official color) ── */
const MicrosoftIcon = () => (
  <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true">
    <rect x="1"  y="1"  width="9" height="9" fill="#f25022"/>
    <rect x="11" y="1"  width="9" height="9" fill="#7fba00"/>
    <rect x="1"  y="11" width="9" height="9" fill="#00a4ef"/>
    <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
  </svg>
);

/* ── Lock icon ── */
const LockIcon = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  /* Read error from URL query (from Microsoft callback redirect) */
  const urlError = new URLSearchParams(window.location.search).get('error');

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const res = await loginAdmin(username.trim(), password);
      if (res.ok && res.body?.user) {
        onLogin(res.body.user);
      } else {
        setError(res.body?.error || 'Invalid username or password.');
      }
    } catch {
      setError('Cannot reach backend. Make sure the backend is running on port 4000.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lp-overlay">
      <div className="lp-card">

        {/* Branding */}
        <div className="lp-brand">
          <div className="lp-brand-icon"><LockIcon /></div>
          <h1 className="lp-title">Report Portal</h1>
          <p className="lp-subtitle">Secure Database &amp; Reporting Console</p>
        </div>

        {/* Error from Microsoft redirect */}
        {urlError && (
          <div className="lp-error-banner">
            ⚠ Microsoft login failed: <strong>{decodeURIComponent(urlError)}</strong>
          </div>
        )}

        {/* Microsoft SSO button */}
        <a
          href={microsoftLoginUrl}
          className="lp-ms-btn"
          onClick={() => setError('')}
        >
          <MicrosoftIcon />
          Sign in with Microsoft
          <span className="lp-ms-badge">2FA via Microsoft</span>
        </a>

        {/* Divider */}
        <div className="lp-divider">
          <span>or</span>
        </div>

        {/* Admin login form */}
        <form className="lp-form" onSubmit={handleAdminLogin} noValidate>
          <p className="lp-section-label">Admin Access</p>

          {error && <div className="lp-error-banner">{error}</div>}

          <div className="lp-field">
            <label className="lp-label" htmlFor="lp-username">Username</label>
            <input
              id="lp-username"
              type="text"
              className="lp-input"
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              autoComplete="username"
            />
          </div>

          <div className="lp-field">
            <label className="lp-label" htmlFor="lp-password">Password</label>
            <input
              id="lp-password"
              type="password"
              className="lp-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="lp-admin-btn"
            disabled={loading || !username || !password}
          >
            {loading ? <span className="lp-spinner" /> : null}
            {loading ? 'Signing in…' : 'Sign in as Admin'}
          </button>
        </form>

        <p className="lp-footer">
          Secure access · Session expires in 8 hours
        </p>
      </div>
    </div>
  );
}
