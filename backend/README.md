# Report Backend

Receives results from the Inspire Scaler workflow and shows them live.

```
UI  --POST {reportType, status}-->  this backend  --POST {requestId, reportType, status}-->  Scaler HTTP Input
                                                    |
                                              Groovy Script (queries Report_db)
                                                    |
                                               HTTP Caller
                                                    |  POST result
                                                    v
UI  <-- live (Server-Sent Events) --  this backend  (/api/scaler/callback)
```

The GUI sends only `reportType` and `status` to the backend
(`POST /api/reports/request`). The backend adds a `requestId`, forwards the JSON
to Scaler (`SCALER_URL`), and returns the `requestId`. When Scaler's HTTP Caller
posts the result back, the backend pushes it live to the GUI, which matches it by
`requestId` and shows the table.

The page at `/monitor` is a working GUI: pick report type and status, click
**Get report**, and the result appears under the form. Raw events are listed below it.

## Run it

Requires Node.js 18+.

```bash
npm install
cp .env.example .env      # set CALLBACK_SECRET
npm start                 # or: npm run dev
```

Live monitor: http://localhost:4000/monitor

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Port to listen on | `4000` |
| `CALLBACK_SECRET` | Secret Scaler must send in the `X-Callback-Secret` header. Empty disables the check | empty |
| `CORS_ORIGIN` | Allowed browser origin(s), comma separated | `http://localhost:5173` |
| `SCALER_URL` | Scaler HTTP Input URL the backend triggers | `http://localhost:30800/rest/api/submit-job/reports` |
| `SCALER_AUTH` | Optional `Authorization` header sent to Scaler | empty |
| `REPORT_TYPES` | Report types shown in the dropdown | `annual_statements,enrollments` |
| `REPORT_STATUSES` | Statuses shown in the dropdown | `COMPLETE,PENDING,FAILED` |

## Configure Scaler's HTTP Caller

Workflow: `HTTP Input -> Groovy Script -> HTTP Caller -> HTTP Response`

| Tab | Field | Value |
|---|---|---|
| General | Request URL | `http://localhost:4000/api/scaler/callback` |
| General | Request method | `POST` |
| General | Timeout (seconds) | `60` |
| Headers | `Content-Type` | `application/json` |
| Headers | `X-Callback-Secret` | same value as `CALLBACK_SECRET` |
| Body | Body content | `${Response_Json}` |

If Scaler runs in Docker, use `http://host.docker.internal:4000/api/scaler/callback`.

## API

### `POST /api/scaler/callback` (Scaler's HTTP Caller calls this)

Body is the `Response_Json` variable from the Groovy script:
```json
{
  "requestId": "b678d6c9-3cf5-4d4c-a682-7a89999ea827",
  "status": "SUCCESS",
  "totalRecords": 2,
  "data": [ { "statement_id": "AS-2041", "status": "COMPLETE" } ],
  "errorMessage": null
}
```
Answers `200 {"received": true}`. `401` for a wrong secret, `400` for a body
that is not a JSON object.

### `POST /api/reports/request` (the GUI calls this)

Body: `{ "reportType": "annual_statements", "status": "COMPLETE" }` (`status` may be empty for all).
Answers `202 {"requestId": "..."}`, `400` for an unknown type or status, or `502` if Scaler
could not be reached (also pushed as an `error` event with the `requestId`).

### Viewing results

| Endpoint | Purpose |
|---|---|
| `GET /api/events` | Server-Sent Events stream. Replays the last 100 events on connect, then streams new ones |
| `GET /api/events/recent` | Last 100 events as JSON |
| `GET /api/results/latest` | Most recent result |
| `GET /api/results/:requestId` | Result for one request |
| `GET /monitor` | Live monitor page |
| `GET /health` | Health check |

Each SSE event looks like `{ "type": "callback", "requestId": "...", "status": "SUCCESS", "data": [...] }`.
Failed callbacks appear as `{ "type": "error", "message": "..." }`.

## Test without Scaler

```bash
# terminal 1
npm start
# terminal 2 (same secret as .env)
CALLBACK_SECRET=change-me npm run mock-scaler
# terminal 3: open http://localhost:4000/monitor, or do what the GUI does:
curl -X POST http://localhost:4000/api/reports/request \
  -H "Content-Type: application/json" \
  -d '{"reportType":"annual_statements","status":"COMPLETE"}'
curl http://localhost:4000/api/results/latest
```

Or test only the callback, as if you were the HTTP Caller:
```bash
curl -X POST http://localhost:4000/api/scaler/callback \
  -H "Content-Type: application/json" -H "X-Callback-Secret: change-me" \
  -d '{"requestId":"manual-1","status":"SUCCESS","totalRecords":1,"data":[{"a":1}],"errorMessage":null}'
```

## Notes

- Results and events are kept in memory. Restarting clears them, and it only
  works as a single instance.
- Keep `CALLBACK_SECRET` set outside local testing, otherwise anyone who can
  reach the callback URL can inject fake results.
- A callback without a `requestId` still appears in the live events list, but the
  result panel can't match it to a request. Make sure the Groovy script copies the
  incoming `requestId` into `Response_Json`.
