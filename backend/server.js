import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';

// ---------------------------------------------------------------
// Config (see .env.example)
// ---------------------------------------------------------------
const PORT = Number(process.env.PORT || 4000);
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const CORS_ORIGIN = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim());

// Where the backend triggers the Scaler workflow (HTTP Input URL)
const SCALER_URL = process.env.SCALER_URL || 'http://localhost:30800/rest/api/submit-job/reports';
const SCALER_AUTH = process.env.SCALER_AUTH || ''; // optional Authorization header value

const csv = (v, d) => (v || d).split(',').map((s) => s.trim()).filter(Boolean);
const REPORT_TYPES = csv(process.env.REPORT_TYPES, 'annual_statements,enrollments');
const REPORT_STATUSES = csv(process.env.REPORT_STATUSES, 'COMPLETE,PENDING,FAILED');

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
// App
// ---------------------------------------------------------------
const app = express();
app.use(cors({ origin: CORS_ORIGIN }));

app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path === '/api/events') return; // SSE stays open, skip noise
    console.log(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - started}ms)`);
  });
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, viewers: sseClients.size }));

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
  const { reportType, status = '', requestId: clientId } = req.body || {};
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
  const job = { requestId, reportType, status };
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


app.listen(PORT, () => {
  console.log(`Report backend listening on http://localhost:${PORT}`);
  console.log(`  Callback URL (for Scaler HTTP Caller): http://localhost:${PORT}/api/scaler/callback`);
  console.log(`  Scaler URL (backend calls this):       ${SCALER_URL}`);
  console.log(`  Callback secret: ${CALLBACK_SECRET ? 'enabled' : 'DISABLED (set CALLBACK_SECRET)'}`);
});
