import { useState, useEffect, useRef } from 'react';
import {
  loginUser,
  registerUser,
  get2faSetup,
  verifyTotp,
  sendEmailOtp,
  verifyEmailOtp,
} from './api.js';

/* ── Icons ── */
const LockIcon = () => (
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);

const PhoneIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
    <line x1="12" y1="18" x2="12.01" y2="18"/>
  </svg>
);

const EmailIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
);

const EyeIcon = ({ off }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {off ? (
      <>
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </>
    ) : (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </>
    )}
  </svg>
);

/* ── Password Strength Evaluator ── */
function getPasswordStrength(pass) {
  if (!pass) return { score: 0, label: '', percent: 0, color: 'transparent' };
  let score = 0;
  if (pass.length >= 6) score += 1;
  if (pass.length >= 10) score += 1;
  if (/[0-9]/.test(pass)) score += 1;
  if (/[a-z]/.test(pass) && /[A-Z]/.test(pass)) score += 1;
  if (/[^A-Za-z0-9]/.test(pass)) score += 1;

  if (score <= 1) return { score: 1, label: 'Weak', percent: 25, color: 'var(--danger)' };
  if (score === 2) return { score: 2, label: 'Fair', percent: 50, color: 'var(--warn)' };
  if (score === 3 || score === 4) return { score: 3, label: 'Good', percent: 75, color: '#3b82f6' };
  return { score: 4, label: 'Strong', percent: 100, color: 'var(--ok)' };
}

/* ── 6-Box Segmented OTP Input Component ── */
function SixBoxOtpInput({ value, onChange, disabled, autoFocus }) {
  const inputsRef = useRef([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || '');

  const handleChange = (index, e) => {
    const raw = e.target.value.replace(/\D/g, '');
    const char = raw.slice(-1);
    const newDigits = [...digits];
    newDigits[index] = char;
    const combined = newDigits.join('').slice(0, 6);
    onChange(combined);

    if (char && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        inputsRef.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted) {
      onChange(pasted);
      const nextFocus = Math.min(pasted.length, 5);
      inputsRef.current[nextFocus]?.focus();
    }
  };

  return (
    <div className="lp-otp-boxes" onPaste={handlePaste} role="group" aria-label="6-digit verification code">
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => (inputsRef.current[i] = el)}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          className={`lp-otp-box ${digits[i] ? 'lp-otp-box--filled' : ''}`}
          value={digits[i]}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          aria-label={`Digit ${i + 1}`}
        />
      ))}
    </div>
  );
}

export default function LoginPage({ onLogin }) {
  // Step 1: Mode & Credentials
  const [mode, setMode]                 = useState('login'); // 'login' | 'register'
  const [username, setUsername]         = useState('');
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock]         = useState(false);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');

  // Step 2: 2FA State
  const [in2fa, setIn2fa]               = useState(false);
  const [twoFaMethod, setTwoFaMethod]   = useState('totp'); // 'totp' | 'email'
  const [maskedEmail, setMaskedEmail]   = useState('');
  const [totpEnabled, setTotpEnabled]   = useState(false);
  const [totpCode, setTotpCode]         = useState('');
  const [emailCode, setEmailCode]       = useState('');
  const [emailSentMsg, setEmailSentMsg] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [cooldown, setCooldown]         = useState(0);

  // Authenticator Setup State
  const [setupData, setSetupData]       = useState(null);
  const [setupLoading, setSetupLoading] = useState(false);

  // 30s Cooldown ticker for email resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const strength = mode === 'register' ? getPasswordStrength(password) : null;

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

      if (res.body?.user) {
        onLogin(res.body.user);
        return;
      }

      if (res.body?.requires2fa) {
        setIn2fa(true);
        setMaskedEmail(res.body.maskedEmail || '');
        setTotpEnabled(!!res.body.totpEnabled);
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

      setIn2fa(true);
      setMaskedEmail(res.body.maskedEmail || '');
      setTotpEnabled(false);
      setTwoFaMethod('totp');
    } catch (e) {
      console.error('[Register error]', e);
      setError(e.message || 'Cannot reach backend. Ensure backend is running on port 4000.');
    } finally {
      setLoading(false);
    }
  };

  /* ─────────────────────────────────────────────────────────────
     Handle TOTP Setup
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
    } catch (e) {
      console.error('[2FA setup error]', e);
      setError(e.message || 'Cannot load 2FA setup from server.');
    } finally {
      setSetupLoading(false);
    }
  };

  /* ─────────────────────────────────────────────────────────────
     Handle TOTP Verification
  ───────────────────────────────────────────────────────────── */
  const handleVerifyTotp = async (e) => {
    e.preventDefault();
    if (totpCode.length !== 6) return;
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
    if (cooldown > 0) return;
    setEmailSending(true);
    setError('');
    setEmailSentMsg('');
    try {
      const res = await sendEmailOtp();
      if (res.ok) {
        setCooldown(30);
        if (res.body?.devNotice) {
          setEmailSentMsg(res.body.message || 'Verification code generated! (Check backend terminal)');
        } else {
          setEmailSentMsg(res.body?.message || 'Verification code sent to your email!');
        }
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
    if (emailCode.length !== 6) return;
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

  return (
    <div className="lp-overlay">
      <div className={`lp-card ${in2fa ? 'lp-card--2fa' : ''}`}>

        {/* 2-Step Progress Indicator */}
        <div className="lp-stepper" aria-label="Authentication Steps">
          <div className={`lp-step ${!in2fa ? 'lp-step--active' : 'lp-step--done'}`}>
            <span className="lp-step-num">{!in2fa ? '1' : '✓'}</span>
            <span className="lp-step-text">Credentials</span>
          </div>
          <div className="lp-step-line" />
          <div className={`lp-step ${in2fa ? 'lp-step--active' : ''}`}>
            <span className="lp-step-num">2</span>
            <span className="lp-step-text">Verification</span>
          </div>
        </div>

        {/* Brand Header */}
        <div className="lp-brand">
          <div className={`lp-brand-icon ${in2fa ? 'lp-brand-icon--2fa' : ''}`}>
            <LockIcon />
          </div>
          <h1 className="lp-title">
            {in2fa ? 'Two-Factor Verification' : 'Report Portal'}
          </h1>
          <p className="lp-subtitle">
            {in2fa
              ? <>Verify your identity for <strong>{username}</strong></>
              : 'Secure Database & Reporting Console'}
          </p>
        </div>

        {error && <div className="lp-error-banner" role="alert">{error}</div>}

        {/* ─────────────────────────────────────────────────────────────
           STEP 2: 2FA Screen
        ───────────────────────────────────────────────────────────── */}
        {in2fa ? (
          <>
            {/* 2FA Method Selector Tabs */}
            <div className="lp-2fa-tabs" role="tablist" aria-label="Two-Factor Method">
              <button
                type="button"
                role="tab"
                aria-selected={twoFaMethod === 'totp'}
                className={`lp-2fa-tab ${twoFaMethod === 'totp' ? 'lp-2fa-tab--active' : ''}`}
                onClick={() => { setTwoFaMethod('totp'); setError(''); }}
              >
                <PhoneIcon />
                Authenticator
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={twoFaMethod === 'email'}
                className={`lp-2fa-tab ${twoFaMethod === 'email' ? 'lp-2fa-tab--active' : ''}`}
                onClick={() => { setTwoFaMethod('email'); setError(''); }}
              >
                <EmailIcon />
                Email Code
              </button>
            </div>

            {/* Method 1: TOTP (Authenticator App) */}
            {twoFaMethod === 'totp' && (
              <div className="lp-2fa-content">
                {!totpEnabled && !setupData ? (
                  <div className="lp-setup-box">
                    <p className="lp-setup-text">
                      Link Microsoft Authenticator or Google Authenticator to your account:
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
                  <div className="lp-qr-box">
                    <p className="lp-qr-instruction">
                      1. Open <strong>Microsoft Authenticator</strong> or <strong>Google Authenticator</strong>.<br/>
                      2. Scan this QR code:
                    </p>
                    <img src={setupData.qrCode} alt="2FA Setup QR Code" className="lp-qr-img" />
                    <p className="lp-qr-secret">
                      Key: <code>{setupData.secret}</code>
                    </p>
                    <p className="lp-qr-instruction">3. Enter the 6-digit code shown in the app:</p>
                  </div>
                ) : (
                  <p className="lp-2fa-instruction">
                    Enter the 6-digit code from Google or Microsoft Authenticator:
                  </p>
                )}

                <form onSubmit={handleVerifyTotp} className="lp-form">
                  <div className="lp-field">
                    <SixBoxOtpInput
                      value={totpCode}
                      onChange={setTotpCode}
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

            {/* Method 2: Email OTP */}
            {twoFaMethod === 'email' && (
              <div className="lp-2fa-content">
                <p className="lp-2fa-instruction">
                  We will send a 6-digit verification code to <strong>{maskedEmail}</strong>:
                </p>

                <button
                  type="button"
                  className="lp-secondary-btn lp-email-send-btn"
                  onClick={handleSendEmailOtp}
                  disabled={emailSending || cooldown > 0}
                >
                  {emailSending
                    ? 'Sending…'
                    : cooldown > 0
                    ? `Resend available in ${cooldown}s`
                    : '✉️ Send Code to Email'}
                </button>

                {emailSentMsg && (
                  <div className="lp-success-banner" role="status">{emailSentMsg}</div>
                )}

                <form onSubmit={handleVerifyEmailOtp} className="lp-form">
                  <div className="lp-field">
                    <label className="lp-label">Enter 6-Digit Code</label>
                    <SixBoxOtpInput
                      value={emailCode}
                      onChange={setEmailCode}
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
          </>
        ) : (
          /* ─────────────────────────────────────────────────────────────
             STEP 1: Initial Login / Register Screen
          ───────────────────────────────────────────────────────────── */
          <>
            {/* Mode Switcher */}
            <div className="lp-mode-tabs" role="tablist" aria-label="Sign In or Register">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                className={`lp-mode-tab ${mode === 'login' ? 'lp-mode-tab--active' : ''}`}
                onClick={() => { setMode('login'); setError(''); }}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={`lp-mode-tab ${mode === 'register' ? 'lp-mode-tab--active' : ''}`}
                onClick={() => { setMode('register'); setError(''); }}
              >
                Create Account
              </button>
            </div>

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
                <div className="lp-label-row">
                  <label className="lp-label" htmlFor="lp-password">Password</label>
                  {capsLock && (
                    <span className="lp-caps-badge" role="alert">
                      ⇪ Caps Lock On
                    </span>
                  )}
                </div>
                <div className="lp-password-wrapper">
                  <input
                    id="lp-password"
                    type={showPassword ? 'text' : 'password'}
                    className="lp-input lp-input--password"
                    placeholder={mode === 'register' ? 'At least 6 characters' : '••••••••'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={(e) => setCapsLock(e.getModifierState && e.getModifierState('CapsLock'))}
                    disabled={loading}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  />
                  <button
                    type="button"
                    className="lp-eye-btn"
                    onClick={() => setShowPassword((p) => !p)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    <EyeIcon off={showPassword} />
                  </button>
                </div>

                {/* Password Strength Meter on Register */}
                {mode === 'register' && password && (
                  <div className="lp-strength-box" aria-live="polite">
                    <div className="lp-strength-bar">
                      <div
                        className="lp-strength-fill"
                        style={{ width: `${strength.percent}%`, background: strength.color }}
                      />
                    </div>
                    <span className="lp-strength-text" style={{ color: strength.color }}>
                      Strength: {strength.label}
                    </span>
                  </div>
                )}
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

            <div className="lp-info-box">
              <div className="lp-info-line">
                <strong>👑 Admin:</strong> Direct sign-in (or 2FA if ADMIN_ENFORCE_2FA enabled)
              </div>
              <div className="lp-info-line">
                <strong>🛡️ Other Accounts:</strong> Protected with 2FA (QR Code Authenticator or Email OTP)
              </div>
            </div>

            <p className="lp-footer">
              Secure access · Session expires in 8 hours
            </p>
          </>
        )}
      </div>
    </div>
  );
}
