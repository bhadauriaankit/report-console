// Pretends to be the Scaler workflow, so you can test without Scaler.
// Accepts the job the UI sends, acknowledges it, then POSTs a result to the
// backend callback exactly like Scaler's HTTP Caller would.
//
//   CALLBACK_SECRET=change-me npm run mock-scaler
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 30800);
const CALLBACK_URL = process.env.CALLBACK_URL || 'http://localhost:4000/api/scaler/callback';
const SECRET = process.env.CALLBACK_SECRET || '';

const DATA = {
  annual_statements: [
    { statement_id: 'AS-2041', account_id: 'ACC-10432', statement_period: '2025', status: 'COMPLETE', generated_date: '2026-02-14' },
    { statement_id: 'AS-2042', account_id: 'ACC-10877', statement_period: '2025', status: 'PENDING',  generated_date: '2026-02-15' },
    { statement_id: 'AS-2043', account_id: 'ACC-11290', statement_period: '2025', status: 'COMPLETE', generated_date: '2026-02-15' },
    { statement_id: 'AS-2044', account_id: 'ACC-10432', statement_period: '2024', status: 'FAILED',   generated_date: '2026-01-30' },
  ],
  enrollments: [
    { enrollment_id: 'EN-8891', member_id: 'MEM-55231', plan_year: '2026', status: 'COMPLETE', generated_date: '2026-01-10' },
    { enrollment_id: 'EN-8892', member_id: 'MEM-55980', plan_year: '2026', status: 'PENDING',  generated_date: '2026-01-11' },
    { enrollment_id: 'EN-8895', member_id: 'MEM-57330', plan_year: '2026', status: 'FAILED',   generated_date: '2026-01-14' },
  ],
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const job = JSON.parse(raw || '{}');
      console.log('Mock Scaler received job:', job);

      // Like the HTTP Response module: acknowledge immediately
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ accepted: true }));

      setTimeout(async () => {
        const table = DATA[job.reportType];
        const body = table
          ? {
              requestId: job.requestId,
              status: 'SUCCESS',
              totalRecords: 0,
              data: [],
              errorMessage: null,
            }
          : {
              requestId: job.requestId,
              status: 'ERROR',
              totalRecords: 0,
              data: [],
              errorMessage: `No such report table: ${job.reportType}`,
            };
        if (table) {
          body.data = job.status ? table.filter((r) => r.status === job.status) : table;
          body.totalRecords = body.data.length;
        }
        const headers = { 'Content-Type': 'application/json' };
        if (SECRET) headers['X-Callback-Secret'] = SECRET;
        const r = await fetch(CALLBACK_URL, { method: 'POST', headers, body: JSON.stringify(body) });
        console.log('Mock Scaler posted callback ->', r.status);
      }, 800);
    });
  })
  .listen(PORT, () => console.log(`Mock Scaler listening on http://localhost:${PORT}`));
