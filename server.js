import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';

// ---------------------------------------------------------------
// Config (see .env.example)
// ---------------------------------------------------------------
const PORT = Number(process.env.PORT || 4000);
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const CORS_ORIGIN = (process.env.CORS_ORIGIN || 'http://localhost:5177,http://localhost:5173')
  .split(',')
  .map((s) => s.trim());

// Where the backend triggers the Scaler workflow (HTTP Input URL)
const SCALER_URL = process.env.SCALER_URL || 'http://localhost:30800/rest/api/submit-job/reports';
const SCALER_AUTH = process.env.SCALER_AUTH || ''; // optional Authorization header value

const csv = (v, d) => (v || d).split(',').map((s) => s.trim()).filter(Boolean);
const REPORT_TYPES = csv(process.env.REPORT_TYPES, 'annual_statements,enrollments');
const REPORT_STATUSES = csv(process.env.REPORT_STATUSES, 'COMPLETE,PENDING,FAILED');

// Map of pending frontend requests waiting for Scaler callback: requestId -> { resolve, reject, timer }
const pendingRequests = new Map();

// ---------------------------------------------------------------
// App
// ---------------------------------------------------------------
const app = express();
app.use(cors({ origin: CORS_ORIGIN }));

app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - started}ms)`);
  });
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/config', (_req, res) =>
  res.json({ reportTypes: REPORT_TYPES, statuses: REPORT_STATUSES })
);

// ---------------------------------------------------------------
// Called by Scaler's HTTP Caller with the fetched data.
// ---------------------------------------------------------------
app.post(
  '/api/scaler/callback',
  express.json({ type: () => true, limit: '10mb' }),
  (req, res) => {
    if (CALLBACK_SECRET && req.get('x-callback-secret') !== CALLBACK_SECRET) {
      return res.status(401).json({ received: false, error: 'Unauthorized' });
    }

    let body = req.body;
    for (let i = 0; i < 2 && typeof body === 'string'; i++) {
      try {
        body = JSON.parse(body);
      } catch {
        break;
      }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ received: false, error: 'Body must be a JSON object' });
    }

    const requestId = body.requestId || null;
    const envelope = {
      requestId,
      status: body.status || 'SUCCESS',
      totalRecords: body.totalRecords ?? (Array.isArray(body.data) ? body.data.length : 0),
      data: Array.isArray(body.data) ? body.data : [],
      errorMessage: body.errorMessage ?? null,
    };

    // Fulfill waiting frontend request directly
    if (requestId && pendingRequests.has(requestId)) {
      const pending = pendingRequests.get(requestId);
      clearTimeout(pending.timer);
      pendingRequests.delete(requestId);
      pending.resolve(envelope);
    }

    return res.json({ received: true, requestId: envelope.requestId });
  }
);

// ---------------------------------------------------------------
// Direct report fetch: triggers Scaler and waits for response
// ---------------------------------------------------------------
app.post('/api/reports/request', express.json(), async (req, res) => {
  const { reportType, status = '' } = req.body || {};
  if (!REPORT_TYPES.includes(reportType)) {
    return res.status(400).json({ error: `reportType must be one of: ${REPORT_TYPES.join(', ')}` });
  }
  if (status && !REPORT_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be empty or one of: ${REPORT_STATUSES.join(', ')}` });
  }

  const requestId = crypto.randomUUID();
  const job = { requestId, reportType, status };

  // Wait for the Scaler callback
  const resultPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Timeout waiting for Scaler callback'));
    }, 60000);

    pendingRequests.set(requestId, { resolve, reject, timer });
  });

  req.on('close', () => {
    if (pendingRequests.has(requestId)) {
      const pending = pendingRequests.get(requestId);
      clearTimeout(pending.timer);
      pendingRequests.delete(requestId);
    }
  });

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
    if (pendingRequests.has(requestId)) {
      const pending = pendingRequests.get(requestId);
      clearTimeout(pending.timer);
      pendingRequests.delete(requestId);
    }
    return res.status(502).json({ error: `Could not trigger Scaler: ${err.message}` });
  }

  try {
    const result = await resultPromise;
    return res.json(result);
  } catch (err) {
    return res.status(504).json({ error: err.message });
  }
});

// Global error handler
app.use((err, req, res, _next) => {
  res.status(400).json({ received: false, error: err.message || 'Invalid request' });
});

app.listen(PORT, () => {
  console.log(`Report backend listening on http://localhost:${PORT}`);
  console.log(`  Callback URL: http://localhost:${PORT}/api/scaler/callback`);
  console.log(`  Scaler URL:   ${SCALER_URL}`);
});
