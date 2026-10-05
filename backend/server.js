import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import pg from 'pg';

// ---------------------------------------------------------------
// PostgreSQL pool (for Live Monitor)
// ---------------------------------------------------------------
const { Pool, Client } = pg;
const pgPool = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  port:     Number(process.env.PG_PORT || 5432),
  database: process.env.PG_DATABASE || 'postgres',
  user:     process.env.PG_USER     || 'postgres',
  password: process.env.PG_PASSWORD || '',
  ssl:      process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 5,
});

pgPool.on('error', (err) => console.error('[pg pool error]', err.message));

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

/** Detect best column to order by so latest date/timestamp/ID rows appear first */
async function getTableOrderClause(pool, table) {
  try {
    const { rows } = await pool.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = $1`,
      [table]
    );
    if (!rows || rows.length === 0) return 'ctid DESC';

    const colNames = rows.map((r) => r.column_name.toLowerCase());

    // 1. Look for known timestamp / date columns
    const priorityDateCols = [
      'created_at', 'creation_date', 'create_time', 'created_date',
      'generated_date', 'date', 'statement_date', 'transaction_date',
      'inserted_at', 'timestamp', 'updated_at', 'record_date'
    ];
    for (const cand of priorityDateCols) {
      const idx = colNames.indexOf(cand);
      if (idx !== -1) return `"${rows[idx].column_name}" DESC`;
    }

    // 2. Any column with date or timestamp in data_type
    const dateTypeRow = rows.find((r) =>
      r.data_type.includes('timestamp') || r.data_type === 'date'
    );
    if (dateTypeRow) return `"${dateTypeRow.column_name}" DESC`;

    // 3. Primary key / ID column (id, *_id)
    const idRow = rows.find((r) => r.column_name.toLowerCase() === 'id');
    if (idRow) return `"${idRow.column_name}" DESC`;

    const anyIdRow = rows.find((r) => r.column_name.toLowerCase().endsWith('_id'));
    if (anyIdRow) return `"${anyIdRow.column_name}" DESC`;

    return 'ctid DESC';
  } catch (_) {
    return 'ctid DESC';
  }
}

// GET /api/pg/rows?table=xxx  – fetch latest 20 rows (ordered by latest date/id desc)
app.get('/api/pg/rows', async (req, res) => {
  const table = req.query.table;
  if (!validTable(table)) return res.status(400).json({ error: 'Invalid table name' });
  try {
    const orderClause = await getTableOrderClause(pgPool, table);
    const { rows } = await pgPool.query(
      `SELECT * FROM "${table}" ORDER BY ${orderClause} LIMIT 20`
    );
    res.json({ rows, orderClause });
  } catch (err) {
    console.error('[pg/rows]', err.message);
    res.status(500).json({ error: err.message });
  }
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
  const client = new Client({
    host:     process.env.PG_HOST     || 'localhost',
    port:     Number(process.env.PG_PORT || 5432),
    database: process.env.PG_DATABASE || 'postgres',
    user:     process.env.PG_USER     || 'postgres',
    password: process.env.PG_PASSWORD || '',
    ssl:      process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

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
  console.log(`Report backend listening on http://localhost:${PORT}`);
  console.log(`  Callback URL (for Scaler HTTP Caller): http://localhost:${PORT}/api/scaler/callback`);
  console.log(`  Scaler URL (backend calls this):       ${SCALER_URL}`);
  console.log(`  Callback secret: ${CALLBACK_SECRET ? 'enabled' : 'DISABLED (set CALLBACK_SECRET)'}`);
});
