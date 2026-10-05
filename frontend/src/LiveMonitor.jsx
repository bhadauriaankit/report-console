import { useCallback, useEffect, useRef, useState } from 'react';
import { getPgTables, getPgRows, pgStreamUrl } from './api.js';
import './LiveMonitor.css';

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
  const [tables, setTables]         = useState([]);
  const [table, setTable]           = useState('');
  const [rows, setRows]             = useState([]);
  const [hasFetched, setHasFetched] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [streaming, setStreaming]   = useState(false);
  const [error, setError]           = useState('');
  const [newIds, setNewIds]         = useState(new Set());
  const [liveCount, setLiveCount]   = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const esRef = useRef(null);

  /* ── Load table list on mount ── */
  useEffect(() => {
    getPgTables()
      .then((d) => {
        if (d.ok && d.body?.tables?.length) {
          setTables(d.body.tables);
          setTable(d.body.tables[0]);
        } else {
          setError(
            d.body?.error ||
              'No tables found — please check your PostgreSQL connection in backend/.env'
          );
        }
      })
      .catch((e) => setError(`Cannot reach backend: ${e.message}`));
  }, []);

  /* ── Close SSE when table changes ── */
  const closeStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setStreaming(false);
  }, []);

  useEffect(() => {
    closeStream();
  }, [table, closeStream]);

  /* ── Fetch rows without re-opening stream (used by Refresh button) ── */
  const fetchRowsOnly = useCallback(async () => {
    if (!table) return;
    setRefreshing(true);
    setError('');
    try {
      const d = await getPgRows(table);
      if (!d.ok) throw new Error(d.body?.error || `HTTP ${d.status}`);
      setRows(d.body.rows || []);
      setHasFetched(true);
      setLastRefreshed(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, [table]);

  /* ── Fetch latest 20 rows and start SSE stream ── */
  const handleFetch = useCallback(async () => {
    if (!table) return;
    closeStream();
    setLoading(true);
    setError('');
    setNewIds(new Set());
    setLiveCount(0);

    try {
      const d = await getPgRows(table);
      if (!d.ok) throw new Error(d.body?.error || `HTTP ${d.status}`);
      setRows(d.body.rows || []);
      setHasFetched(true);
      setLastRefreshed(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }

    /* ── Start live stream ── */
    const es = new EventSource(pgStreamUrl(table));
    esRef.current = es;

    es.onopen = () => setStreaming(true);

    es.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'insert') {
          setRows((prev) => {
            const next = [msg.row, ...prev].slice(0, 20);
            setNewIds(new Set([0])); // index 0 is always the newest row
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

  /* ── Manual Refresh ── */
  const handleRefresh = useCallback(() => {
    fetchRowsOnly();
  }, [fetchRowsOnly]);

  /* ── Cleanup on unmount ── */
  useEffect(() => () => closeStream(), [closeStream]);

  const busy = loading || refreshing;

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
              onChange={(e) => {
                setTable(e.target.value);
                setHasFetched(false);
                setRows([]);
              }}
              disabled={busy || !tables.length}
            >
              {tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Fetch Button */}
          <button
            className="lm-btn-primary"
            onClick={handleFetch}
            disabled={busy || !table}
          >
            {loading ? <span className="lm-spinner" /> : <IconRefresh />}
            {loading ? 'Fetching…' : (hasFetched ? 'Re-fetch' : 'Fetch')}
          </button>

          {/* Refresh Button */}
          {hasFetched && (
            <button
              className="lm-btn-secondary"
              onClick={handleRefresh}
              disabled={busy || !table}
              title="Refresh latest 20 rows from PostgreSQL"
            >
              {refreshing ? <span className="lm-spinner" /> : <IconRefresh />}
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          )}

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
          <div className="lm-results-header-right">
            {lastRefreshed && (
              <span className="lm-refreshed-time" title="Last refreshed time">
                Updated {lastRefreshed}
              </span>
            )}
            {hasFetched && (
              <button
                className="lm-btn-icon-refresh"
                onClick={handleRefresh}
                disabled={busy}
                title="Refresh latest rows"
              >
                <IconRefresh />
                <span>Refresh</span>
              </button>
            )}
            {hasFetched && (
              <span className="lm-pill">{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>

        {!hasFetched && !loading && (
          <div className="lm-placeholder">
            Select a table and click <strong>Fetch</strong> to begin.
          </div>
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
