# Report Backend & GUI

Simple report fetching interface and backend for Inspire Scaler workflow results.

```
Frontend (React)  --POST {reportType, status}-->  Backend  --POST {requestId, ...}-->  Scaler HTTP Input
                                                    |                                         |
                                                    | (awaits callback response)        Groovy Script
                                                    |                                         |
                                                    |                                    HTTP Caller
                                                    |                                         |
Frontend (React)  <-- JSON { data: [...] } <--------+<-- POST result (/api/scaler/callback) -+
```

## Run it

Requires Node.js 18+.

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Run backend (port 4000)
npm run dev

# Run frontend GUI in a separate terminal (port 5177)
npm run gui
```

Frontend is accessible at http://localhost:5177.

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Backend port | `4000` |
| `CALLBACK_SECRET` | Secret Scaler must send in `X-Callback-Secret` header | empty |
| `CORS_ORIGIN` | Allowed origins | `http://localhost:5177,http://localhost:5173` |
| `SCALER_URL` | Scaler HTTP Input URL | `http://localhost:30800/rest/api/submit-job/reports` |
| `SCALER_AUTH` | Optional `Authorization` header sent to Scaler | empty |
| `REPORT_TYPES` | Report types | `annual_statements,enrollments` |
| `REPORT_STATUSES` | Report statuses | `COMPLETE,PENDING,FAILED` |

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

### `POST /api/reports/request`
Triggered when the user clicks **Fetch**. Waits for Scaler's callback and returns the result data directly to the frontend.

### `POST /api/scaler/callback`
Called by Scaler's HTTP Caller when report processing completes.
