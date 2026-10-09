import { useState, useEffect } from 'react';
import {
  loginUser,
  get2faSetup,
  verifyTotp,
  sendEmailOtp,
  verifyEmailOtp,
} from './api.js';

/* ── Lock Icon ── */
const LockIcon = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);

/* ── Phone Icon (TOTP) ── */
const PhoneIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
    <line x1="12" y1="18" x2="12.01" y2="18"/>
  </svg>
);

/* ── Email Icon ── */
const EmailIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
);

export default function LoginPage({ onLogin }) {
  // Step 1: Mode & Credentials
  const [mode, setMode]         = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  // Step 2: 2FA State
  const [in2fa, setIn2fa]                   = useState(false);
  const [twoFaMethod, setTwoFaMethod]       = useState('totp'); // 'totp' | 'email'
  const [maskedEmail, setMaskedEmail]       = useState('');
  const [totpEnabled, setTotpEnabled]       = useState(false);
  const [totpCode, setTotpCode]             = useState('');
  const [emailCode, setEmailCode]           = useState('');
  const [emailSentMsg, setEmailSentMsg]     = useState('');
  const [emailSending, setEmailSending]     = useState(false);

  // Authenticator Setup State (if user has no TOTP yet)
  const [setupData, setSetupData]           = useState(null); // { secret, qrCode }
  const [setupLoading, setSetupLoading]     = useState(false);

  /* ─────────────────────────────────────────────────────────────
     Handle Step 1: Initial Login
  ───────────────────────────────────────────────────────────── */
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError('');

    try {
      const res = await loginUser(username.trim(), password);
      if (!res.ok) {
        setError(res.body?.error || 'Invalid username or password.');
        setLoading(false);
        return;
      }

      // If Admin -> logged in immediately
      if (res.body?.user) {
        onLogin(res.body.user);
        return;
      }

      // If requires 2FA -> switch to 2FA screen
      if (res.body?.requires2fa) {
        setIn2fa(true);
        setMaskedEmail(res.body.maskedEmail || '');
        setTotpEnabled(!!res.body.totpEnabled);
        // Default to email if TOTP is not configured yet, else TOTP
        setTwoFaMethod(res.body.totpEnabled ? 'totp' : 'email');
      }
    } catch {
      setError('Cannot reach backend. Ensure backend is running on port 4000.');
    } finally {
      setLoading(false);
    }
  };

  /* ─────────────────────────────────────────────────────────────
     Handle Step 1: Account Registration
  ───────────────────────────────────────────────────────────── */
  const handleRegister = async (e) => {
    e.preventDefault();
    if (!username.trim() || !email.trim() || !password) return;
    setLoading(true);
    setError('');

    try {
      const res = await registerUser(username.trim(), email.trim(), password);
      if (!res.ok) {
        setError(res.body?.error || 'Registration failed.');
        setLoading(false);
        return;
      }

      // Account created! Automatically transition to 2FA setup!
      setIn2fa(true);
      setMaskedEmail(res.body.maskedEmail || '');
      setTotpEnabled(false); // Brand new user, needs setup
      setTwoFaMethod('totp'); // Start directly with QR code setup!
    } catch {
      setError('Cannot reach backend. Ensure backend is running on port 4000.');
    } finally {
      setLoading(false);
    }
  };


  /* ─────────────────────────────────────────────────────────────
     Handle TOTP Setup (QR code fetching)
  ───────────────────────────────────────────────────────────── */
  const handleLoadTotpSetup = async () => {
    setSetupLoading(true);
    setError('');
    try {
      const res = await get2faSetup();
      if (res.ok && res.body?.qrCode) {
        setSetupData(res.body);
      } else {
        setError(res.body?.error || 'Failed to load QR code setup.');
      }
    } catch {
      setError('Cannot load 2FA setup from server.');
    } finally {
      setSetupLoading(false);
    }
  };

  /* ─────────────────────────────────────────────────────────────
     Handle TOTP Verification
  ───────────────────────────────────────────────────────────── */
  const handleVerifyTotp = async (e) => {
    e.preventDefault();
    if (!totpCode.trim()) return;
    setLoading(true);
    setError('');

    try {
      const isSetup = !totpEnabled;
      const res = await verifyTotp(totpCode.trim(), isSetup);
      if (res.ok && res.body?.user) {
        onLogin(res.body.user);
      } else {
        setError(res.body?.error || 'Invalid 6-digit authenticator code.');
      }
    } catch {
      setError('Verification failed. Server unreachable.');
    } finally {
      setLoading(false);
    }
  };

  /* ─────────────────────────────────────────────────────────────
     Handle Email OTP Sending & Verification
  ───────────────────────────────────────────────────────────── */
  const handleSendEmailOtp = async () => {
    setEmailSending(true);
    setError('');
    setEmailSentMsg('');
    try {
      const res = await sendEmailOtp();
      if (res.ok) {
        setEmailSentMsg(res.body?.message || 'Verification code sent to your email!');
      } else {
        setError(res.body?.error || 'Failed to send verification code.');
      }
    } catch {
      setError('Failed to contact email service.');
    } finally {
      setEmailSending(false);
    }
  };

  const handleVerifyEmailOtp = async (e) => {
    e.preventDefault();
    if (!emailCode.trim()) return;
    setLoading(true);
    setError('');

    try {
      const res = await verifyEmailOtp(emailCode.trim());
      if (res.ok && res.body?.user) {
        onLogin(res.body.user);
      } else {
        setError(res.body?.error || 'Incorrect or expired verification code.');
      }
    } catch {
      setError('Verification error. Server unreachable.');
    } finally {
      setLoading(false);
    }
  };

  /* ─────────────────────────────────────────────────────────────
     RENDER: Step 2 — 2FA Screen
  ───────────────────────────────────────────────────────────── */
  if (in2fa) {
    return (
      <div className="lp-overlay">
        <div className="lp-card lp-card--2fa">
          {/* Header */}
          <div className="lp-brand">
            <div className="lp-brand-icon lp-brand-icon--2fa">
              <LockIcon />
            </div>
            <h1 className="lp-title">Two-Factor Authentication</h1>
            <p className="lp-subtitle">
              Verify your identity for <strong>{username}</strong>
            </p>
          </div>

          {/* 2FA Method Selector Tabs */}
          <div className="lp-2fa-tabs">
            <button
              type="button"
              className={`lp-2fa-tab ${twoFaMethod === 'totp' ? 'lp-2fa-tab--active' : ''}`}
              onClick={() => { setTwoFaMethod('totp'); setError(''); }}
            >
              <PhoneIcon />
              Authenticator App
            </button>
            <button
              type="button"
              className={`lp-2fa-tab ${twoFaMethod === 'email' ? 'lp-2fa-tab--active' : ''}`}
              onClick={() => { setTwoFaMethod('email'); setError(''); }}
            >
              <EmailIcon />
              Email Code
            </button>
          </div>

          {error && <div className="lp-error-banner">{error}</div>}

          {/* ── Method 1: TOTP (Google/Microsoft Authenticator) ── */}
          {twoFaMethod === 'totp' && (
            <div className="lp-2fa-content">
              {!totpEnabled && !setupData ? (
                /* First-time setup prompt */
                <div className="lp-setup-box">
                  <p className="lp-setup-text">
                    You haven't set up an authenticator app yet. Link Microsoft Authenticator or Google Authenticator to your account:
                  </p>
                  <button
                    type="button"
                    className="lp-secondary-btn"
                    onClick={handleLoadTotpSetup}
                    disabled={setupLoading}
                  >
                    {setupLoading ? 'Generating QR Code…' : '📷 Show QR Code to Scan'}
                  </button>
                </div>
              ) : !totpEnabled && setupData ? (
                /* QR Code display */
                <div className="lp-qr-box">
                  <p className="lp-qr-instruction">
                    1. Open <strong>Microsoft Authenticator</strong> or <strong>Google Authenticator</strong> on your phone.<br/>
                    2. Scan this QR code:
                  </p>
                  <img src={setupData.qrCode} alt="2FA QR Code" className="lp-qr-img" />
                  <p className="lp-qr-secret">
                    Key: <code>{setupData.secret}</code>
                  </p>
                  <p className="lp-qr-instruction">3. Enter the 6-digit code shown in the app:</p>
                </div>
              ) : (
                /* Already enabled prompt */
                <p className="lp-2fa-instruction">
                  Open <strong>Google Authenticator</strong> or <strong>Microsoft Authenticator</strong> on your phone and enter the 6-digit code:
                </p>
              )}

              <form onSubmit={handleVerifyTotp} className="lp-form">
                <div className="lp-field">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className="lp-input lp-input--code"
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    disabled={loading}
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  className="lp-admin-btn"
                  disabled={loading || totpCode.length !== 6}
                >
                  {loading ? <span className="lp-spinner" /> : null}
                  {loading ? 'Verifying…' : 'Verify & Continue'}
                </button>
              </form>
            </div>
          )}

          {/* ── Method 2: Email OTP ── */}
          {twoFaMethod === 'email' && (
            <div className="lp-2fa-content">
              <p className="lp-2fa-instruction">
                We will send a 6-digit verification code to <strong>{maskedEmail}</strong>:
              </p>

              <button
                type="button"
                className="lp-secondary-btn lp-email-send-btn"
                onClick={handleSendEmailOtp}
                disabled={emailSending}
              >
                {emailSending ? 'Sending…' : '✉️ Send Code to Email'}
              </button>

              {emailSentMsg && (
                <div className="lp-success-banner">{emailSentMsg}</div>
              )}

              <form onSubmit={handleVerifyEmailOtp} className="lp-form">
                <div className="lp-field">
                  <label className="lp-label">Enter 6-Digit Email Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className="lp-input lp-input--code"
                    placeholder="000000"
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ''))}
                    disabled={loading}
                  />
                </div>
                <button
                  type="submit"
                  className="lp-admin-btn"
                  disabled={loading || emailCode.length !== 6}
                >
                  {loading ? <span className="lp-spinner" /> : null}
                  {loading ? 'Verifying…' : 'Verify & Continue'}
                </button>
              </form>
            </div>
          )}

          {/* Cancel & Back to Login */}
          <button
            type="button"
            className="lp-back-btn"
            onClick={() => {
              setIn2fa(false);
              setPassword('');
              setTotpCode('');
              setEmailCode('');
              setError('');
            }}
          >
            ← Back to Login
          </button>
        </div>
      </div>
    );
  }

  /* ─────────────────────────────────────────────────────────────
     RENDER: Step 1 — Initial Login Screen
  ───────────────────────────────────────────────────────────── */
  return (
    <div className="lp-overlay">
      <div className="lp-card">
        {/* Branding */}
        <div className="lp-brand">
          <div className="lp-brand-icon"><LockIcon /></div>
          <h1 className="lp-title">Report Portal</h1>
          <p className="lp-subtitle">Secure Database &amp; Reporting Console</p>
        </div>

        {/* Mode Toggle: Sign In vs Create Account */}
        <div className="lp-mode-tabs">
          <button
            type="button"
            className={`lp-mode-tab ${mode === 'login' ? 'lp-mode-tab--active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`lp-mode-tab ${mode === 'register' ? 'lp-mode-tab--active' : ''}`}
            onClick={() => { setMode('register'); setError(''); }}
          >
            Create Account
          </button>
        </div>

        {error && <div className="lp-error-banner">{error}</div>}

        {/* ── Form: Sign In or Register ── */}
        <form className="lp-form" onSubmit={mode === 'login' ? handleLogin : handleRegister} noValidate>
          <div className="lp-field">
            <label className="lp-label" htmlFor="lp-username">
              {mode === 'login' ? 'Username or Email' : 'Username'}
            </label>
            <input
              id="lp-username"
              type="text"
              className="lp-input"
              placeholder={mode === 'login' ? 'admin or your_username' : 'Choose a username'}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              autoComplete="username"
              autoFocus
            />
          </div>

          {mode === 'register' && (
            <div className="lp-field">
              <label className="lp-label" htmlFor="lp-email">Email Address</label>
              <input
                id="lp-email"
                type="email"
                className="lp-input"
                placeholder="your.email@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                autoComplete="email"
              />
            </div>
          )}

          <div className="lp-field">
            <label className="lp-label" htmlFor="lp-password">Password</label>
            <input
              id="lp-password"
              type="password"
              className="lp-input"
              placeholder={mode === 'register' ? 'At least 6 characters' : '••••••••'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
          </div>

          <button
            type="submit"
            className="lp-admin-btn"
            disabled={
              loading ||
              !username.trim() ||
              !password ||
              (mode === 'register' && !email.trim())
            }
          >
            {loading ? <span className="lp-spinner" /> : null}
            {loading
              ? (mode === 'login' ? 'Verifying…' : 'Creating Account…')
              : (mode === 'login' ? 'Sign In' : 'Create Account & Setup 2FA')}
          </button>
        </form>

        {/* Security / Help Info Box */}
        <div className="lp-info-box">
          <div className="lp-info-line">
            <strong>👑 Admin:</strong> Direct sign-in without 2FA
          </div>
          <div className="lp-info-line">
            <strong>🛡️ Other Accounts:</strong> Protected with 2FA (QR Code Authenticator or Email OTP)
          </div>
        </div>


        <p className="lp-footer">
          Secure access · Session expires in 8 hours
        </p>
      </div>
    </div>
  );
}
