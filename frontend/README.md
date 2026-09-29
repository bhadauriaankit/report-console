# Report frontend (React + Vite)

Pick a report type and status, click **Get report**. The app sends the request to the
backend, which triggers Scaler; Scaler's result comes back through the backend and is shown in a table.

## Run

1. Start the backend (`report-backend`): `npm start` (http://localhost:4000)
2. In this folder:
   ```
   npm install
   npm run dev
   ```
3. Open http://localhost:5173

In dev, Vite forwards `/api/*` to the backend (see `vite.config.js`), so no CORS setup is needed.
If your backend is on another address, run with `BACKEND_URL=http://host:port npm run dev`
(on Windows PowerShell: `$env:BACKEND_URL="http://host:port"; npm run dev`).

## Production build

```
npm run build
```
Serve the `dist/` folder, and set `VITE_API_URL` (see `.env.example`) to the backend address
before building. Then add the frontend's address to `CORS_ORIGIN` in the backend `.env`.

## Files

- `src/useReport.js`: sends the request and waits for the result (live stream, polling as backup, 60 s timeout)
- `src/App.jsx`: form and status messages
- `src/ResultTable.jsx`: result table
- `src/api.js`: backend calls
