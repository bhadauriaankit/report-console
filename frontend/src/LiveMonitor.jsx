import { useCallback, useEffect, useRef, useState } from 'react';
import './LiveMonitor.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';

/* ── helpers ── */
const toLabel = (key) =>
  key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/* ── icons ── */
const IconDatabase = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
  </svg>
);

const IconRefresh = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <polyline points="23 4 23 10 17 10"/>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
);

const IconWifi = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
    <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
    <line x1="12" y1="20" x2="12.01" y2="20"/>
  </svg>
);

/* ── ResultsTable (shared style but new rows flash) ── */
function MonitorTable({ rows, newIds }) {
  if (!rows || rows.length === 0) return null;
  const columns = Object.keys(rows[0]);

  return (
    <div className="lm-table-scroll">
      <table className="lm-table">
        <thead>
          <tr>
            {columns.map((c) => <th key={c}>{toLabel(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={newIds.has(i) ? 'lm-row-new' : ''}>
              {columns.map((c) => (
                <td key={c}>{String(row[c] ?? '—')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Main component ── */
export default function LiveMonitor() {
  const [tables, setTables]       = useState([]);
  const [table, setTable]         = useState('');
  const [rows, setRows]           = useState([]);
  const [hasFetched, setHasFetched] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [streaming, setStreaming]  = useState(false);
  const [error, setError]         = useState('');
  const [newIds, setNewIds]       = useState(new Set());
  const [liveCount, setLiveCount] = useState(0);

  const esRef = useRef(null);

  /* ── Load table list on mount ── */
  useEffect(() => {
    fetch(`${API}/api/pg/tables`)
      .then((r) => r.json())
      .then((d) => {
        if (d.tables?.length) {
          setTables(d.tables);
          setTable(d.tables[0]);
        } else {
          setError('No tables found – check your PostgreSQL connection in backend/.env');
        }
      })
      .catch((e) => setError(`Cannot reach backend: ${e.message}`));
  }, []);

  /* ── Close SSE when table changes ── */
  const closeStream = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setStreaming(false);
  }, []);

  useEffect(() => { closeStream(); }, [table, closeStream]);

  /* ── Fetch latest 20 rows ── */
  const handleFetch = useCallback(async () => {
    if (!table) return;
    closeStream();
    setLoading(true);
    setError('');
    setNewIds(new Set());
    setLiveCount(0);
    try {
      const r = await fetch(`${API}/api/pg/rows?table=${encodeURIComponent(table)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setRows(d.rows);
      setHasFetched(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }

    /* ── Start live stream ── */
    const es = new EventSource(`${API}/api/pg/stream?table=${encodeURIComponent(table)}`);
    esRef.current = es;

    es.onopen = () => setStreaming(true);

    es.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'insert') {
          setRows((prev) => {
            const next = [msg.row, ...prev].slice(0, 20);
            setNewIds(new Set([0])); // index 0 is always the newest
            setTimeout(() => setNewIds(new Set()), 2500);
            return next;
          });
          setLiveCount((c) => c + 1);
        }
        if (msg.type === 'error') {
          setError(`Live stream: ${msg.message}`);
          setStreaming(false);
        }
      } catch (_) {}
    };

    es.onerror = () => {
      setStreaming(false);
    };
  }, [table, closeStream]);

  /* ── Cleanup on unmount ── */
  useEffect(() => () => closeStream(), [closeStream]);

  return (
    <div className="lm-page">

      {/* Header */}
      <div className="lm-page-header">
        <h1 className="lm-page-title">Live Monitor</h1>
        <p className="lm-page-subtitle">
          Select a PostgreSQL table, fetch the latest 20 rows, and watch new inserts appear in real time.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="lm-error-banner" role="alert">
          <span>{error}</span>
          <button className="lm-banner-close" onClick={() => setError('')}>✕</button>
        </div>
      )}

      {/* Filter card */}
      <div className="lm-card lm-filter-card">
        <div className="lm-filter-row">

          <div className="lm-field">
            <label className="lm-label" htmlFor="lm-table">Table</label>
            <select
              id="lm-table"
              value={table}
              onChange={(e) => { setTable(e.target.value); setHasFetched(false); setRows([]); }}
              disabled={loading || !tables.length}
            >
              {tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <button
            className="lm-btn-primary"
            onClick={handleFetch}
            disabled={loading || !table}
          >
            {loading ? <span className="lm-spinner" /> : <IconRefresh />}
            {loading ? 'Fetching…' : 'Fetch'}
          </button>

          {/* Live badge */}
          <span className={`lm-live-badge ${streaming ? 'lm-live-badge--on' : ''}`}>
            <IconWifi />
            {streaming ? `Live · ${liveCount} new` : 'Offline'}
          </span>
        </div>
      </div>

      {/* Results card */}
      <div className="lm-card lm-results-card">
        <div className="lm-results-header">
          <span className="lm-results-title">
            <IconDatabase />
            {hasFetched ? table : 'Results'}
          </span>
          {hasFetched && (
            <span className="lm-pill">{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {!hasFetched && !loading && (
          <div className="lm-placeholder">Select a table and click <strong>Fetch</strong> to begin.</div>
        )}

        {loading && (
          <div className="lm-placeholder">
            <span className="lm-spinner" /> Fetching…
          </div>
        )}

        {hasFetched && !loading && rows.length === 0 && (
          <div className="lm-placeholder lm-empty">No rows in this table yet.</div>
        )}

        {hasFetched && !loading && rows.length > 0 && (
          <MonitorTable rows={rows} newIds={newIds} />
        )}
      </div>
    </div>
  );
}
