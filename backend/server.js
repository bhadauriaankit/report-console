import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import SftpClient from 'ssh2-sftp-client';
import session from 'express-session';
import * as msal from '@azure/msal-node';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';


// ---------------------------------------------------------------
// PostgreSQL pool & configuration (strictly from environment variables)
// ---------------------------------------------------------------
const { Pool, Client } = pg;

// Prevent pg from auto-converting DATE and TIMESTAMP into JS Date objects
// (which shifts dates backward by timezone offset when serialized to JSON).
// OID 1082 = DATE, OID 1114 = TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1082, (str) => str);
pg.types.setTypeParser(1114, (str) => str);

const pgConfig = {
  host:     process.env.PG_HOST,
  port:     process.env.PG_PORT ? Number(process.env.PG_PORT) : undefined,
  database: process.env.PG_DATABASE,
  user:     process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl:      process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

const pgPool = new Pool({ ...pgConfig, max: 5 });

pgPool.on('error', (err) => console.error('[pg pool error]', err.message));

// ---------------------------------------------------------------
// Config (strictly from environment variables)
// ---------------------------------------------------------------
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : [];

// Scaler configuration from environment variables
const SCALER_URL = process.env.SCALER_URL;
const SCALER_AUTH = process.env.SCALER_AUTH;

const csv = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const REPORT_TYPES = csv(process.env.REPORT_TYPES);
const REPORT_STATUSES = csv(process.env.REPORT_STATUSES);

// ---------------------------------------------------------------
// SFTP Configuration & Helpers (for remote file storage)
// ---------------------------------------------------------------
const SFTP_ENABLED = process.env.SFTP_ENABLED === 'true';

function getSftpConfig() {
  const config = {
    host:     process.env.SFTP_HOST,
    port:     Number(process.env.SFTP_PORT || 22),
    username: process.env.SFTP_USER,
  };
  if (process.env.SFTP_PASSWORD) {
    config.password = process.env.SFTP_PASSWORD;
  }
  if (process.env.SFTP_KEY_PATH && fs.existsSync(process.env.SFTP_KEY_PATH)) {
    config.privateKey = fs.readFileSync(process.env.SFTP_KEY_PATH);
  }
  return config;
}

/** Streams a file directly from the SFTP server to Express response */
async function streamFromSftp(targetPath, res) {
  const config = getSftpConfig();
  if (!config.host || !config.username) {
    throw new Error('SFTP_HOST and SFTP_USER must be set in backend/.env to use SFTP');
  }

  const sftp = new SftpClient();
  try {
    await sftp.connect(config);

    // Normalize path: strip sftp://user@host prefix if present
    let remotePath = targetPath;
    if (remotePath.startsWith('sftp://')) {
      remotePath = remotePath.replace(/^sftp:\/\/[^/]+\/?/, '');
    }
    // Prepend base path if configured and path does not already include it
    if (process.env.SFTP_BASE_PATH) {
      const basePath = process.env.SFTP_BASE_PATH.replace(/\/+$/, '');
      if (!remotePath.startsWith(basePath)) {
        remotePath = `${basePath}/${remotePath.replace(/^\/+/, '')}`;
      }
    }


    const fileType = await sftp.exists(remotePath);
    if (!fileType) {
      throw new Error(`File not found on SFTP server at: ${remotePath}`);
    }

    // Pipe remote stream directly into response
    await sftp.get(remotePath, res);
  } finally {
    try { await sftp.end(); } catch (_) {}
  }
}

// ---------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------
const events = []; // last 100 events, replayed to newly connected viewers
const results = new Map(); // requestId -> result envelope (last 50)
const sseClients = new Set();
let latestResult = null;

function emit(type, data = {}) {
  const evt = { id: crypto.randomUUID(), time: new Date().toISOString(), type, ...data };
  events.push(evt);
  if (events.length > 100) events.shift();
  const line = `data: ${JSON.stringify(evt)}\n\n`;
  for (const client of sseClients) client.write(line);
  return evt;
}

function remember(envelope) {
  latestResult = envelope;
  if (envelope.requestId) {
    results.set(envelope.requestId, envelope);
    if (results.size > 50) results.delete(results.keys().next().value);
  }
}

// ---------------------------------------------------------------
// Authentication Configuration
// ---------------------------------------------------------------
const ADMIN_USER     = process.env.ADMIN_USER     || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@1234';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Azure AD / Microsoft login config
const AZURE_CLIENT_ID     = process.env.AZURE_CLIENT_ID     || '';
const AZURE_TENANT_ID     = process.env.AZURE_TENANT_ID     || 'common';
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || '';
const AZURE_REDIRECT_URI  = process.env.AZURE_REDIRECT_URI  || 'http://localhost:4000/api/auth/callback';
const MICROSOFT_ENABLED   = !!(AZURE_CLIENT_ID && AZURE_CLIENT_SECRET);

// MSAL confidential client (only when Azure credentials are configured)
let msalClient = null;
if (MICROSOFT_ENABLED) {
  msalClient = new msal.ConfidentialClientApplication({
    auth: {
      clientId:     AZURE_CLIENT_ID,
      authority:    `https://login.microsoftonline.com/${AZURE_TENANT_ID}`,
      clientSecret: AZURE_CLIENT_SECRET,
    },
  });
}

// ---------------------------------------------------------------
// App
// ---------------------------------------------------------------
const app = express();

app.use(cors({
  origin: CORS_ORIGIN.length ? CORS_ORIGIN : true,
  credentials: true,
}));

// Session middleware (HttpOnly cookie, 8h expiry)
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

// Request logger
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path === '/api/events') return;
    console.log(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - started}ms)`);
  });
  next();
});

// Auth guard – protects all API routes except auth endpoints
function requireAuth(req, res, next) {
  const open = ['/api/auth/', '/health'];
  if (open.some((p) => req.path.startsWith(p))) return next();
  if (req.session?.user) return next();
  return res.status(401).json({ error: 'Unauthorized', code: 'NOT_LOGGED_IN' });
}
app.use(requireAuth);

app.get('/health', (_req, res) => res.json({ ok: true, viewers: sseClients.size }));

// ---------------------------------------------------------------
// 2FA & SMTP Email Configuration
// ---------------------------------------------------------------
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || `"Report Portal" <${SMTP_USER || 'no-reply@reportportal.local'}>`;
const SMTP_ENABLED = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

let mailTransporter = null;
if (SMTP_ENABLED) {
  mailTransporter = nodemailer.createTransporter({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

// In-memory Email OTP store (email -> { code, expiresAt, userPayload })
const emailOtpStore = new Map();

// Helper: Auto-create portal_users table if not exists and seed default demo user
async function initAuthDb() {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS public.portal_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        totp_secret VARCHAR(100),
        totp_enabled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Check if demo user exists; if not, create one: 'demo_user' / 'Demo@1234'
    const { rows } = await pgPool.query(`SELECT id FROM public.portal_users WHERE username = 'demo_user' LIMIT 1`);
    if (rows.length === 0) {
      const demoHash = await bcrypt.hash('Demo@1234', 10);
      await pgPool.query(`
        INSERT INTO public.portal_users (username, email, password_hash, role)
        VALUES ('demo_user', 'demo@company.com', $1, 'user');
      `, [demoHash]);
      console.log('  [Auth DB] Initialized demo user: demo_user / Demo@1234');
    }
  } catch (err) {
    console.error('  [Auth DB error]', err.message);
  }
}
initAuthDb();

// ---------------------------------------------------------------
// Auth Endpoints
// ---------------------------------------------------------------

// GET /api/auth/me — returns current session user (or 401)
app.get('/api/auth/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in', code: 'NOT_LOGGED_IN' });
  res.json({ user: req.session.user });
});

// POST /api/auth/register — Create a new account and immediately start 2FA setup
app.post('/api/auth/register', express.json(), async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }

  const cleanUser = username.trim().toLowerCase();
  const cleanEmail = email.trim().toLowerCase();

  // Basic email validation
  if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  try {
    // Check if username or email already taken
    const existing = await pgPool.query(
      `SELECT username, email FROM public.portal_users WHERE LOWER(username) = $1 OR LOWER(email) = $2`,
      [cleanUser, cleanEmail]
    );

    if (existing.rows.length > 0) {
      const match = existing.rows[0];
      if (match.username.toLowerCase() === cleanUser) {
        return res.status(409).json({ error: 'This username is already taken. Please choose another.' });
      }
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Hash password and insert
    const passwordHash = await bcrypt.hash(password, 10);
    const insertRes = await pgPool.query(
      `INSERT INTO public.portal_users (username, email, password_hash, role)
       VALUES ($1, $2, $3, 'user')
       RETURNING id, username, email, role, totp_enabled`,
      [username.trim(), cleanEmail, passwordHash]
    );

    const newUser = insertRes.rows[0];

    // Immediately put into pending 2FA state so user sets up 2FA right away!
    req.session.pending2fa = {
      id: newUser.id,
      username: newUser.username,
      email: newUser.email,
      role: newUser.role || 'user',
      totp_enabled: false,
    };

    const emailParts = newUser.email.split('@');
    const maskedEmail = `${emailParts[0].slice(0, 1)}***@${emailParts[1] || ''}`;

    return res.json({
      ok: true,
      requires2fa: true,
      isNewAccount: true,
      maskedEmail,
      totpEnabled: false,
      username: newUser.username,
    });
  } catch (err) {
    console.error('[auth/register]', err.message);
    return res.status(500).json({ error: 'Failed to create account. Database error.' });
  }
});

// POST /api/auth/login — First step: verify username + password
// If Admin -> logs in immediately
// If Regular user -> enters 2FA state (returns 2FA required response)
app.post('/api/auth/login', express.json(), async (req, res) => {

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  // 1. Check if Admin master login
  if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
    req.session.user = { name: 'Administrator', email: username, role: 'admin' };
    return res.json({ ok: true, user: req.session.user });
  }

  // 2. Check portal_users table in PostgreSQL
  try {
    const { rows } = await pgPool.query(
      `SELECT * FROM public.portal_users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1`,
      [username.trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const dbUser = rows[0];
    const match = await bcrypt.compare(password, dbUser.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Password valid! Store temporary 2FA pending state in session
    req.session.pending2fa = {
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      role: dbUser.role || 'user',
      totp_enabled: dbUser.totp_enabled,
      totp_secret: dbUser.totp_secret,
    };

    // Mask email for privacy (e.g. d***@company.com)
    const emailParts = dbUser.email.split('@');
    const maskedEmail = `${emailParts[0].slice(0, 1)}***@${emailParts[1] || ''}`;

    return res.json({
      ok: true,
      requires2fa: true,
      maskedEmail,
      totpEnabled: dbUser.totp_enabled,
      username: dbUser.username,
    });
  } catch (err) {
    console.error('[auth/login]', err.message);
    return res.status(500).json({ error: 'Database authentication error' });
  }
});

// GET /api/auth/2fa/setup — Generate new TOTP QR code for user
app.get('/api/auth/2fa/setup', async (req, res) => {
  const pending = req.session?.pending2fa;
  if (!pending) return res.status(401).json({ error: 'Session expired or not in 2FA mode' });

  const secret = authenticator.generateSecret();
  req.session.pending2fa.tempSecret = secret;

  const otpauth = authenticator.keyuri(pending.username, 'ReportPortal', secret);
  try {
    const qrCodeDataUrl = await QRCode.toDataURL(otpauth);
    res.json({
      secret,
      qrCode: qrCodeDataUrl,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// POST /api/auth/2fa/verify-totp — Verify 6-digit Authenticator code
app.post('/api/auth/2fa/verify-totp', express.json(), async (req, res) => {
  const pending = req.session?.pending2fa;
  if (!pending) return res.status(401).json({ error: 'Session expired or not in 2FA mode' });

  const { token, isSetup } = req.body || {};
  if (!token) return res.status(400).json({ error: '6-digit code required' });

  const secretToVerify = isSetup ? pending.tempSecret : pending.totp_secret;
  if (!secretToVerify) {
    return res.status(400).json({ error: 'Authenticator has not been set up. Please set up first.' });
  }

  const isValid = authenticator.verify({ token: token.trim(), secret: secretToVerify });
  if (!isValid) {
    return res.status(400).json({ error: 'Invalid authenticator code. Codes refresh every 30 seconds.' });
  }

  // If this was a setup verification, save secret and set totp_enabled = true in DB
  if (isSetup) {
    try {
      await pgPool.query(
        `UPDATE public.portal_users SET totp_secret = $1, totp_enabled = TRUE WHERE id = $2`,
        [secretToVerify, pending.id]
      );
    } catch (dbErr) {
      console.error('[auth/2fa/setup save]', dbErr.message);
    }
  }

  // 2FA Verified! Promote to full session
  req.session.user = {
    name: pending.username,
    email: pending.email,
    role: pending.role,
  };
  delete req.session.pending2fa;

  res.json({ ok: true, user: req.session.user });
});

// POST /api/auth/2fa/send-email-otp — Generate and send 6-digit code to user email
app.post('/api/auth/2fa/send-email-otp', async (req, res) => {
  const pending = req.session?.pending2fa;
  if (!pending) return res.status(401).json({ error: 'Session expired or not in 2FA mode' });

  // Generate 6-digit random code
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity

  emailOtpStore.set(pending.email.toLowerCase(), { code, expiresAt });

  console.log(`\n======================================================`);
  console.log(`🔐 [EMAIL 2FA OTP] For: ${pending.email}`);
  console.log(`   Verification Code: ${code} (Expires in 5 minutes)`);
  console.log(`======================================================\n`);

  if (SMTP_ENABLED && mailTransporter) {
    try {
      await mailTransporter.sendMail({
        from: SMTP_FROM,
        to: pending.email,
        subject: `Your Login Verification Code: ${code}`,
        html: `
          <div style="font-family:sans-serif;padding:24px;background:#f9fafb;border-radius:12px;">
            <h2 style="color:#111827;margin-top:0;">Report Portal Login Verification</h2>
            <p style="color:#4b5563;font-size:15px;">Use the following 6-digit code to complete your login:</p>
            <div style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#2563eb;padding:16px 0;">
              ${code}
            </div>
            <p style="color:#6b7280;font-size:13px;">This code will expire in 5 minutes. If you did not attempt to log in, please ignore this email.</p>
          </div>
        `,
      });
      return res.json({ ok: true, sent: true, message: `Verification code sent to your email` });
    } catch (mailErr) {
      console.error('[email otp send error]', mailErr.message);
      // Still allow testing via console print
      return res.json({
        ok: true,
        sent: false,
        message: `SMTP not configured or error. Check backend terminal for the OTP code.`,
      });
    }
  } else {
    // Local / Dev mode: code printed to console
    return res.json({
      ok: true,
      sent: false,
      devNotice: true,
      message: `Code generated! (Check backend terminal for OTP code: ${code})`,
    });
  }
});

// POST /api/auth/2fa/verify-email-otp — Verify email 6-digit OTP code
app.post('/api/auth/2fa/verify-email-otp', express.json(), (req, res) => {
  const pending = req.session?.pending2fa;
  if (!pending) return res.status(401).json({ error: 'Session expired or not in 2FA mode' });

  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: '6-digit code required' });

  const record = emailOtpStore.get(pending.email.toLowerCase());
  if (!record) {
    return res.status(400).json({ error: 'No OTP requested or code expired. Please request a new code.' });
  }

  if (Date.now() > record.expiresAt) {
    emailOtpStore.delete(pending.email.toLowerCase());
    return res.status(400).json({ error: 'Code expired. Please request a new one.' });
  }

  if (record.code !== String(code).trim()) {
    return res.status(400).json({ error: 'Incorrect verification code. Please check and try again.' });
  }

  // Success: Clear code and promote to full session
  emailOtpStore.delete(pending.email.toLowerCase());
  req.session.user = {
    name: pending.username,
    email: pending.email,
    role: pending.role,
  };
  delete req.session.pending2fa;

  res.json({ ok: true, user: req.session.user });
});

// POST /api/auth/logout — destroy session
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});




// Requests sent to Scaler that have not been answered yet (requestId -> time sent).
// Used as a fallback when Scaler's callback does not include the requestId.
const pending = new Map();
const PENDING_TTL_MS = 2 * 60 * 1000;

function takePending(requestId) {
  const now = Date.now();
  for (const [id, t] of pending) if (now - t > PENDING_TTL_MS) pending.delete(id);
  if (requestId) { pending.delete(requestId); return requestId; }
  const oldest = pending.keys().next().value; // oldest unanswered request
  if (oldest) pending.delete(oldest);
  return oldest || null;
}

// ---------------------------------------------------------------
// Called by Scaler's HTTP Caller with the fetched data.
// Accepts any content-type and parses it as JSON, because the
// HTTP Caller may not set application/json.
// ---------------------------------------------------------------
app.post(
  '/api/scaler/callback',
  express.json({ type: () => true, limit: '10mb' }),
  (req, res) => {
    if (CALLBACK_SECRET && req.get('x-callback-secret') !== CALLBACK_SECRET) {
      emit('error', { message: 'Callback rejected: bad or missing X-Callback-Secret header' });
      return res.status(401).json({ received: false, error: 'Unauthorized' });
    }

    let body = req.body;
    // Tolerate a double-encoded body (JSON inside a JSON string)
    for (let i = 0; i < 2 && typeof body === 'string'; i++) {
      try {
        body = JSON.parse(body);
      } catch {
        break;
      }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      emit('error', { message: 'Callback body was not a JSON object' });
      return res.status(400).json({ received: false, error: 'Body must be a JSON object' });
    }

    let requestId = body.requestId || null;
    if (!requestId) {
      requestId = takePending(null);
      console.warn(
        requestId
          ? `Callback had no requestId; matched it to the oldest pending request ${requestId}. ` +
            'Add requestId to Response_Json in the Groovy script.'
          : 'Callback had no requestId and no request is pending.'
      );
    } else {
      takePending(requestId);
    }

    const envelope = {
      requestId,
      status: body.status || 'SUCCESS',
      totalRecords: body.totalRecords ?? (Array.isArray(body.data) ? body.data.length : 0),
      data: Array.isArray(body.data) ? body.data : [],
      errorMessage: body.errorMessage ?? null,
    };

    remember(envelope);
    emit('callback', envelope); // pushed live to every connected viewer

    return res.json({ received: true, requestId: envelope.requestId });
  }
);

// ---------------------------------------------------------------
// GUI -> backend -> Scaler
// The GUI sends { reportType, status }. The backend adds a requestId,
// forwards the JSON to Scaler's HTTP Input, and returns the requestId.
// Scaler's answer arrives later on /api/scaler/callback and is pushed
// to the GUI through /api/events, matched by requestId.
// ---------------------------------------------------------------
app.get('/api/config', (_req, res) =>
  res.json({ reportTypes: REPORT_TYPES, statuses: REPORT_STATUSES })
);

app.post('/api/reports/request', express.json(), async (req, res) => {
  const {
    reportType,
    status = '',
    requestId: clientId,
    datePreset,
    dateFrom,
    dateTo,
  } = req.body || {};
  if (!REPORT_TYPES.includes(reportType)) {
    return res.status(400).json({ error: `reportType must be one of: ${REPORT_TYPES.join(', ')}` });
  }
  if (status && !REPORT_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be empty or one of: ${REPORT_STATUSES.join(', ')}` });
  }

  // The GUI supplies its own requestId so it can listen before Scaler answers
  // (Scaler can call back before this request even returns).
  const requestId = typeof clientId === 'string' && /^[\w-]{8,64}$/.test(clientId)
    ? clientId
    : crypto.randomUUID();

  // Build the job forwarded to Scaler — always forward date fields when present
  const job = { requestId, reportType, status };
  if (datePreset) job.datePreset = datePreset;
  if (dateFrom)   job.dateFrom   = dateFrom;
  if (dateTo)     job.dateTo     = dateTo;

  console.log('Raw request:', JSON.stringify(job));

  if (!SCALER_URL) {
    const message = 'SCALER_URL is not configured in backend/.env';
    emit('error', { requestId: job.requestId, message });
    return res.status(503).json({ requestId: job.requestId, error: message });
  }

  pending.set(requestId, Date.now());
  emit('request', job);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (SCALER_AUTH) headers.Authorization = SCALER_AUTH;
    const r = await fetch(SCALER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Scaler answered HTTP ${r.status}`);
  } catch (err) {
    pending.delete(job.requestId);
    const message = `Could not trigger Scaler: ${err.message}`;
    emit('error', { requestId: job.requestId, message });
    return res.status(502).json({ requestId: job.requestId, error: message });
  }

  return res.status(202).json({ requestId: job.requestId });
});


// Invalid JSON on the callback route: report it instead of Express's HTML error page
app.use((err, req, res, _next) => {
  if (req.path === '/api/scaler/callback') {
    emit('error', { message: `Callback body was not valid JSON: ${err.message}` });
  }
  res.status(400).json({ received: false, error: 'Invalid JSON body' });
});

// ---------------------------------------------------------------
// Real-time review: SSE stream + lookups + monitor page
// ---------------------------------------------------------------
app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  for (const evt of events) res.write(`data: ${JSON.stringify(evt)}\n\n`); // replay recent
  sseClients.add(res);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

app.get('/api/events/recent', (_req, res) => res.json(events));

app.get('/api/results/latest', (_req, res) =>
  latestResult ? res.json(latestResult) : res.status(404).json({ error: 'No results yet' })
);

app.get('/api/results/:requestId', (req, res) => {
  const found = results.get(req.params.requestId);
  return found ? res.json(found) : res.status(404).json({ error: 'Not found' });
});



// ---------------------------------------------------------------
// Live Monitor – PostgreSQL endpoints
// ---------------------------------------------------------------

/** Allowed table name: only word chars, max 64 chars */
const validTable = (t) => typeof t === 'string' && /^\w{1,64}$/.test(t);

// GET /api/pg/tables  – list all user tables in the connected DB
app.get('/api/pg/tables', async (_req, res) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type   = 'BASE TABLE'
        ORDER BY table_name`
    );
    res.json({ tables: rows.map((r) => r.table_name) });
  } catch (err) {
    console.error('[pg/tables]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Detect best column to order by and date column for filtering */
async function getTableMetadata(pool, table) {
  try {
    const { rows } = await pool.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = $1`,
      [table]
    );
    if (!rows || rows.length === 0) {
      return { orderClause: 'ctid DESC', dateColumn: null, columns: [] };
    }

    const colNames = rows.map((r) => r.column_name.toLowerCase());

    // 1. Look for known timestamp / date columns
    const priorityDateCols = [
      'created_at', 'creation_date', 'create_time', 'created_date',
      'generated_date', 'date', 'statement_date', 'transaction_date',
      'inserted_at', 'timestamp', 'updated_at', 'record_date'
    ];
    let dateCol = null;
    for (const cand of priorityDateCols) {
      const idx = colNames.indexOf(cand);
      if (idx !== -1) {
        dateCol = { name: rows[idx].column_name, type: rows[idx].data_type };
        break;
      }
    }

    // 2. Any column with date or timestamp in data_type
    if (!dateCol) {
      const dateTypeRow = rows.find((r) =>
        r.data_type.includes('timestamp') || r.data_type === 'date'
      );
      if (dateTypeRow) {
        dateCol = { name: dateTypeRow.column_name, type: dateTypeRow.data_type };
      }
    }

    // Determine order clause
    let orderClause = 'ctid DESC';
    if (dateCol) {
      orderClause = `"${dateCol.name}" DESC`;
    } else {
      const idRow = rows.find((r) => r.column_name.toLowerCase() === 'id');
      if (idRow) {
        orderClause = `"${idRow.column_name}" DESC`;
      } else {
        const anyIdRow = rows.find((r) => r.column_name.toLowerCase().endsWith('_id'));
        if (anyIdRow) {
          orderClause = `"${anyIdRow.column_name}" DESC`;
        }
      }
    }

    return { orderClause, dateColumn: dateCol, columns: rows };
  } catch (_) {
    return { orderClause: 'ctid DESC', dateColumn: null, columns: [] };
  }
}

// GET /api/pg/rows?table=xxx&limit=100&dateFrom=...&dateTo=...&datePreset=...
app.get('/api/pg/rows', async (req, res) => {
  const table = req.query.table;
  if (!validTable(table)) return res.status(400).json({ error: 'Invalid table name' });

  // Default to 100 records as requested
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const { dateFrom, dateTo, datePreset, status } = req.query;

  try {
    const meta = await getTableMetadata(pgPool, table);
    const conditions = [];
    const params = [];

    // Apply status filter if status column exists in table (cast to text to support PostgreSQL ENUMs)
    if (status && typeof status === 'string' && status.trim()) {
      const statusCol = meta.columns.find((c) => c.column_name.toLowerCase() === 'status');
      if (statusCol) {
        params.push(status.trim());
        conditions.push(`LOWER("${statusCol.column_name}"::text) = LOWER($${params.length})`);
      }
    }


    // Apply date filter if dateColumn exists and filter requested
    if (meta.dateColumn) {
      const col = `"${meta.dateColumn.name}"`;
      const isDateType = meta.dateColumn.type.includes('timestamp') || meta.dateColumn.type === 'date';

      let from = dateFrom;
      let to = dateTo;
      if (datePreset === 'today') {
        const todayStr = new Date().toISOString().slice(0, 10);
        from = from || todayStr;
        to = to || todayStr;
      }

      if (from && from === to) {
        params.push(from);
        if (isDateType) {
          conditions.push(`${col}::date = $${params.length}::date`);
        } else {
          conditions.push(`${col}::text LIKE $${params.length} || '%'`);
        }
      } else {
        if (from) {
          params.push(from);
          if (isDateType) {
            conditions.push(`${col}::date >= $${params.length}::date`);
          } else {
            conditions.push(`${col}::text >= $${params.length}`);
          }
        }
        if (to) {
          params.push(to);
          if (isDateType) {
            conditions.push(`${col}::date <= $${params.length}::date`);
          } else {
            conditions.push(`${col}::text <= $${params.length} || ' 23:59:59'`);
          }
        }
      }
    }


    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);
    const limitPlaceholder = `$${params.length}`;

    const statusCol = meta.columns.find((c) => c.column_name.toLowerCase() === 'status');
    let distinctStatuses = [];
    if (statusCol) {
      try {
        const statusRes = await pgPool.query(
          `SELECT DISTINCT "${statusCol.column_name}"::text AS val FROM "${table}" WHERE "${statusCol.column_name}" IS NOT NULL ORDER BY 1 LIMIT 50`
        );
        distinctStatuses = statusRes.rows.map((r) => r.val).filter(Boolean);
      } catch (_) {}
    }

    const query = `SELECT * FROM "${table}" ${whereSql} ORDER BY ${meta.orderClause} LIMIT ${limitPlaceholder}`;
    const { rows } = await pgPool.query(query, params);

    res.json({

      rows,
      orderClause: meta.orderClause,
      dateColumn: meta.dateColumn?.name || null,
      statusColumn: statusCol?.column_name || null,
      statuses: distinctStatuses,
      total: rows.length,
      limit,
    });
  } catch (err) {
    console.error('[pg/rows]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pg/file?path=xxx&download=1
// Securely streams a file referenced in database attachment column (supports SFTP & local disk)
app.get('/api/pg/file', async (req, res) => {
  const targetPath = req.query.path;
  if (!targetPath || typeof targetPath !== 'string') {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  const isDownload = req.query.download === '1' || req.query.download === 'true';
  const cleanPath = targetPath.replace(/^sftp:\/\/[^/]*\/?/, '');
  const filename = path.basename(cleanPath);

  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.htm':  'text/html; charset=utf-8',
    '.pdf':  'application/pdf',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.svg':  'image/svg+xml',
    '.txt':  'text/plain; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.csv':  'text/csv; charset=utf-8',
  };
  if (mimeTypes[ext]) {
    res.setHeader('Content-Type', mimeTypes[ext]);
  }
  res.setHeader('Content-Disposition', `${isDownload ? 'attachment' : 'inline'}; filename="${filename}"`);

  // 1. Check if path explicitly starts with sftp:// or SFTP_ENABLED is true and not found locally
  const isExplicitSftp = targetPath.startsWith('sftp://');
  const resolvedLocal = path.resolve(targetPath);
  let existsLocal = false;
  try {
    existsLocal = !isExplicitSftp && fs.existsSync(resolvedLocal) && fs.statSync(resolvedLocal).isFile();
  } catch (_) {
    existsLocal = false;
  }

  if (isExplicitSftp || (SFTP_ENABLED && !existsLocal)) {
    try {
      await streamFromSftp(targetPath, res);
      return;
    } catch (sftpErr) {
      console.error('[pg/file/sftp]', sftpErr.message);
      if (!res.headersSent) {
        return res.status(502).json({ error: `SFTP storage error: ${sftpErr.message}` });
      }
      return;
    }
  }

  // 2. Stream from local disk if exists
  if (existsLocal) {
    fs.createReadStream(resolvedLocal).pipe(res);
    return;
  }

  return res.status(404).json({
    error: `File not found on local disk. (SFTP is ${SFTP_ENABLED ? 'enabled but file not found on remote server' : 'disabled - set SFTP_ENABLED=true in backend/.env'})`,
  });
});

// GET /api/pg/stream?table=xxx  – SSE stream of new inserts via LISTEN/NOTIFY
// Requires a trigger on the table. If missing, we auto-create it.
app.get('/api/pg/stream', async (req, res) => {
  const table = req.query.table;
  if (!validTable(table)) return res.status(400).json({ error: 'Invalid table name' });

  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection:      'keep-alive',
  });
  res.flushHeaders();

  // Dedicated client per SSE connection (LISTEN requires a dedicated conn)
  const client = new Client(pgConfig);

  const channel = `lm_${table}`;

  const cleanup = () => { try { client.end(); } catch (_) {} };

  try {
    await client.connect();

    // Auto-create trigger function + trigger if they don't exist
    await client.query(`
      CREATE OR REPLACE FUNCTION _lm_notify_fn()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_notify(TG_ARGV[0], row_to_json(NEW)::text);
        RETURN NEW;
      END;
      $$;
    `);

    // Drop + recreate trigger so it always uses the latest channel name
    await client.query(`DROP TRIGGER IF EXISTS _lm_notify ON "${table}"`);
    await client.query(`
      CREATE TRIGGER _lm_notify
      AFTER INSERT ON "${table}"
      FOR EACH ROW EXECUTE FUNCTION _lm_notify_fn('${channel}')
    `);

    await client.query(`LISTEN "${channel}"`);

    // Push new rows as SSE events
    client.on('notification', (msg) => {
      try {
        const row = JSON.parse(msg.payload);
        res.write(`data: ${JSON.stringify({ type: 'insert', row })}\n\n`);
      } catch (_) {}
    });

    // Keep-alive ping every 20s
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);

    req.on('close', () => {
      clearInterval(ping);
      cleanup();
    });
  } catch (err) {
    console.error('[pg/stream]', err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    cleanup();
  }
});

app.listen(PORT, () => {
  const sftpConfig = getSftpConfig();
  console.log(`Report backend listening on http://localhost:${PORT}`);
  console.log(`  Callback URL (for Scaler HTTP Caller): http://localhost:${PORT}/api/scaler/callback`);
  console.log(`  Scaler URL (backend calls this):       ${SCALER_URL || '(not configured)'}`);
  console.log(`  Callback secret: ${CALLBACK_SECRET ? 'enabled' : 'DISABLED (set CALLBACK_SECRET)'}`);
  console.log(`  SFTP Remote Storage: ${SFTP_ENABLED ? `ENABLED (${sftpConfig.host || 'unknown'}:${sftpConfig.port})` : 'DISABLED (using local disk fallback)'}`);
});

