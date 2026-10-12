import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { getConfig } from './api.js';
import { useReport } from './useReport.js';
import './ReportConsole.css';

/* ── Fallback options ── */
const FALLBACK_REPORT_TYPES = ['statement', 'transaction', 'account_summary'];
const FALLBACK_STATUSES = ['Complete', 'Failed', 'Pending', 'In progress'];

/* ── Helpers ── */
const toLabel = (key) =>
  String(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const formatDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const getTodayStr = () => formatDateStr(new Date());

const statusClass = (val) => {
  const v = String(val).toLowerCase().replace(/\s+/g, '_');
  if (v === 'complete' || v === 'success') return 'badge-complete';
  if (v === 'failed' || v === 'error') return 'badge-failed';
  if (v === 'pending' || v === 'in_progress') return 'badge-pending';
  return 'badge-neutral';
};

/* ── Icons ── */
const IconDownload = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

const IconX = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const IconCode = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="15" height="15">
    <polyline points="16 18 22 12 16 6"/>
    <polyline points="8 6 2 12 8 18"/>
  </svg>
);

/* ── Export helpers ── */
function rowsToCSV(columns, rows) {
  const escape = (v) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const header = columns.map(escape).join(',');
  const body = rows.map((row) => columns.map((c) => escape(row[c])).join(',')).join('\n');
  return `${header}\n${body}`;
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7days', label: 'Last 7 Days' },
  { id: 'mtd', label: 'Month to Date' },
];

export default function ReportConsole() {
  /* ── Config state ── */
  const [reportTypes, setReportTypes] = useState([]);
  const [statuses, setStatuses]       = useState([]);

  /* ── Filter state ── */
  const [reportType, setReportType]   = useState('');
  const [status, setStatus]           = useState('');
  const [dateFrom, setDateFrom]       = useState('');
  const [dateTo, setDateTo]           = useState('');
  const [activePreset, setActivePreset] = useState(null);

  /* ── UI state ── */
  const [errorBanner, setErrorBanner]   = useState('');
  const [hasFetched, setHasFetched]     = useState(false);
  const [exportFormat, setExportFormat] = useState('csv');
  const [selectedRow, setSelectedRow]   = useState(null);
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [copiedJson, setCopiedJson]     = useState(false);
  const [lastActivity, setLastActivity] = useState(null);

  /* ── Report hook ── */
  const { run, phase, message, rows, total, connected } = useReport();
  const isLoading = phase === 'waiting';

  /* ── Load config on mount ── */
  useEffect(() => {
    getConfig()
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const types = r.body?.reportTypes?.length ? r.body.reportTypes : FALLBACK_REPORT_TYPES;
        const sts   = r.body?.statuses?.length ? r.body.statuses : FALLBACK_STATUSES;
        setReportTypes(types);
        setStatuses(sts);
        setReportType(types[0] || '');
      })
      .catch((err) => {
        setReportTypes(FALLBACK_REPORT_TYPES);
        setStatuses(FALLBACK_STATUSES);
        setReportType(FALLBACK_REPORT_TYPES[0]);
        setErrorBanner(`Could not load configuration: ${err.message}`);
      });
  }, []);

  /* ── Sync API errors ── */
  useEffect(() => {
    if (phase === 'error' && message) {
      setErrorBanner(message);
      setLastActivity(new Date().toLocaleTimeString());
    } else if (phase === 'done') {
      setLastActivity(new Date().toLocaleTimeString());
    }
  }, [phase, message]);

  /* ── Quick date preset handler ── */
  const handleApplyPreset = (presetId) => {
    const now = new Date();
    if (activePreset === presetId) {
      setActivePreset(null);
      setDateFrom('');
      setDateTo('');
      return;
    }

    setActivePreset(presetId);
    if (presetId === 'today') {
      const today = getTodayStr();
      setDateFrom(today);
      setDateTo(today);
    } else if (presetId === 'yesterday') {
      const y = new Date();
      y.setDate(now.getDate() - 1);
      const str = formatDateStr(y);
      setDateFrom(str);
      setDateTo(str);
    } else if (presetId === '7days') {
      const past = new Date();
      past.setDate(now.getDate() - 7);
      setDateFrom(formatDateStr(past));
      setDateTo(getTodayStr());
    } else if (presetId === 'mtd') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      setDateFrom(formatDateStr(first));
      setDateTo(getTodayStr());
    }
  };

  /* ── Fetch handler ── */
  const handleFetch = useCallback(() => {
    setErrorBanner('');
    setHasFetched(true);
    setLastActivity(new Date().toLocaleTimeString());
    run(reportType, status, activePreset || undefined, dateFrom || undefined, dateTo || undefined);
  }, [run, reportType, status, activePreset, dateFrom, dateTo]);

  /* ── Export ── */
  const displayRows = rows || [];
  const columns = displayRows.length > 0 ? Object.keys(displayRows[0]) : [];

  const handleExport = () => {
    if (!displayRows.length) return;
    if (exportFormat === 'json') {
      const json = JSON.stringify(displayRows, null, 2);
      downloadFile(json, `report_${reportType || 'export'}_${Date.now()}.json`, 'application/json');
    } else {
      const csv = rowsToCSV(columns, displayRows);
      downloadFile(csv, `report_${reportType || 'export'}_${Date.now()}.csv`, 'text/csv;charset=utf-8;');
    }
  };

  const handleCopyJson = () => {
    const dataToCopy = selectedRow ? selectedRow : displayRows;
    navigator.clipboard.writeText(JSON.stringify(dataToCopy, null, 2)).then(() => {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    });
  };

  return (
    <div className="rc-page">
      {/* ── Page header ── */}
      <div className="rc-page-header">
        <div className="rc-title-block">
          <h1 className="rc-page-title">Report Console</h1>
          <p className="rc-page-subtitle">
            Configure report queries, stream live callbacks via Scaler, and inspect structured data payloads.
          </p>
        </div>

        {/* SSE Stream Status Pill */}
        <div className="rc-conn-status-bar">
          <div
            className={`rc-conn-pill ${connected ? 'rc-conn-pill--online' : (isLoading ? 'rc-conn-pill--connecting' : 'rc-conn-pill--offline')}`}
            title={`Real-Time Scaler Connection: ${connected ? 'Connected' : 'Disconnected'}`}
            role="status"
            aria-live="polite"
          >
            <span className="rc-conn-dot" />
            <span className="rc-conn-text">
              {connected ? 'SSE Connected' : (isLoading ? 'Connecting…' : 'SSE Idle')}
            </span>
          </div>
          {lastActivity && (
            <span className="rc-last-activity" title="Last server response timestamp">
              Activity: {lastActivity}
            </span>
          )}
        </div>
      </div>

      {/* ── Error banner ── */}
      {errorBanner && (
        <div className="rc-error-banner" role="alert" aria-live="assertive">
          <span className="rc-error-text">⚠️ {errorBanner}</span>
          <button
            type="button"
            className="rc-banner-close"
            aria-label="Dismiss error notification"
            onClick={() => setErrorBanner('')}
          >
            <IconX />
          </button>
        </div>
      )}

      {/* ── Filter Card ── */}
      <div className="rc-card rc-filter-card">
        {/* Responsive Filter Grid (Collapses cleanly under 768px) */}
        <div className="rc-filter-grid">
          <div className="rc-field">
            <label className="rc-label" htmlFor="rc-report-type">Report Type</label>
            <select
              id="rc-report-type"
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              disabled={isLoading}
            >
              {reportTypes.map((t) => (
                <option key={t} value={t}>{toLabel(t)}</option>
              ))}
            </select>
          </div>

          <div className="rc-field">
            <label className="rc-label" htmlFor="rc-status">Status Filter</label>
            <select
              id="rc-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={isLoading}
            >
              <option value="">All Statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="rc-field">
            <label className="rc-label" htmlFor="rc-date-from">Date From</label>
            <input
              id="rc-date-from"
              type="text"
              inputMode="numeric"
              placeholder="yyyy-mm-dd"
              value={dateFrom}
              onChange={(e) => { setActivePreset(null); setDateFrom(e.target.value); }}
              disabled={isLoading}
            />
          </div>

          <div className="rc-field">
            <label className="rc-label" htmlFor="rc-date-to">Date To</label>
            <input
              id="rc-date-to"
              type="text"
              inputMode="numeric"
              placeholder="yyyy-mm-dd"
              value={dateTo}
              onChange={(e) => { setActivePreset(null); setDateTo(e.target.value); }}
              disabled={isLoading}
            />
          </div>
        </div>

        {/* Date presets scrollable chip row */}
        <div className="rc-presets-bar" role="group" aria-label="Date presets">
          <span className="rc-presets-label">Quick Presets:</span>
          <div className="rc-presets-scroll">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`rc-chip ${activePreset === p.id ? 'rc-chip--active' : ''}`}
                onClick={() => handleApplyPreset(p.id)}
                disabled={isLoading}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <hr className="rc-divider" />

        <div className="rc-action-row">
          <button
            type="button"
            className="rc-btn-primary"
            onClick={handleFetch}
            disabled={isLoading || !reportType}
          >
            {isLoading ? <span className="rc-spinner" /> : null}
            {isLoading ? 'Waiting for Scaler…' : 'Submit Report Request'}
          </button>
        </div>
      </div>

      {/* ── Results Card ── */}
      <div className="rc-card rc-results-card">
        <div className="rc-results-header">
          <div className="rc-results-title-group">
            <span className="rc-results-title">Response Payload</span>
            {hasFetched && (
              <span className="rc-pill">
                {total} {total === 1 ? 'record' : 'records'}
              </span>
            )}
          </div>

          {hasFetched && displayRows.length > 0 && (
            <div className="rc-results-header-right">
              <button
                type="button"
                className="rc-btn-secondary"
                onClick={() => { setSelectedRow(null); setDrawerOpen(true); }}
                title="Inspect Raw JSON"
              >
                <IconCode /> Inspect JSON
              </button>

              <div className="rc-export-group">
                <select
                  className="rc-export-select"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}
                  aria-label="Select export format"
                >
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
                <button
                  type="button"
                  className="rc-btn-export"
                  onClick={handleExport}
                  title={`Export dataset as ${exportFormat.toUpperCase()}`}
                >
                  <IconDownload /> Export
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Skeleton Loaders while fetching */}
        {isLoading && (
          <div className="rc-skeleton-table" aria-label="Loading report data">
            <div className="skeleton-box" style={{ marginBottom: 12, height: 38 }} />
            <div className="skeleton-line" style={{ marginBottom: 10, width: '100%' }} />
            <div className="skeleton-line" style={{ marginBottom: 10, width: '92%' }} />
            <div className="skeleton-line" style={{ marginBottom: 10, width: '96%' }} />
            <div className="skeleton-line" style={{ marginBottom: 10, width: '88%' }} />
          </div>
        )}

        {/* Empty state: Not fetched */}
        {!hasFetched && !isLoading && (
          <div className="rc-placeholder">
            Select your report filters above and click <strong>Submit Report Request</strong> to stream records.
          </div>
        )}

        {/* Empty state: No records */}
        {hasFetched && !isLoading && displayRows.length === 0 && phase !== 'error' && (
          <div className="rc-placeholder rc-empty">
            No matching records returned by Scaler for this query.
          </div>
        )}

        {/* Data Table */}
        {hasFetched && !isLoading && displayRows.length > 0 && (
          <div className="rc-table-scroll" role="region" aria-label="Report Data Table" tabIndex={0}>
            <table className="rc-table">
              <thead>
                <tr>
                  <th className="rc-th-idx">#</th>
                  {columns.map((c) => (
                    <th key={c}>{toLabel(c)}</th>
                  ))}
                  <th className="rc-th-actions">Detail</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, i) => (
                  <tr key={i} onClick={() => { setSelectedRow(row); setDrawerOpen(true); }}>
                    <td className="rc-td-idx">{i + 1}</td>
                    {columns.map((c) => (
                      <td key={c}>
                        {c.toLowerCase() === 'status' ? (
                          <span className={`rc-badge ${statusClass(row[c])}`}>{String(row[c])}</span>
                        ) : (
                          String(row[c] ?? '—')
                        )}
                      </td>
                    ))}
                    <td>
                      <button
                        type="button"
                        className="rc-row-view-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedRow(row);
                          setDrawerOpen(true);
                        }}
                        title="View Raw Row JSON"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Slide-over Results Drawer / Mobile Bottom Sheet ── */}
      {drawerOpen && (
        <div className="rc-drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <div
            className="rc-drawer-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rc-drawer-title"
          >
            <div className="rc-drawer-header">
              <div>
                <h3 id="rc-drawer-title" className="rc-drawer-title">
                  {selectedRow ? 'Record Detail Inspector' : 'Full Dataset JSON'}
                </h3>
                <span className="rc-drawer-subtitle">
                  {selectedRow ? 'Inspecting selected row attributes' : `${displayRows.length} total entries`}
                </span>
              </div>

              <div className="rc-drawer-actions">
                <button
                  type="button"
                  className="rc-btn-secondary"
                  onClick={handleCopyJson}
                  title="Copy JSON to clipboard"
                >
                  {copiedJson ? '✓ Copied' : 'Copy JSON'}
                </button>
                <button
                  type="button"
                  className="rc-banner-close"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close inspector drawer"
                >
                  <IconX />
                </button>
              </div>
            </div>

            <div className="rc-drawer-body">
              <pre className="rc-json-code">
                <code>
                  {JSON.stringify(selectedRow || displayRows, null, 2)}
                </code>
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
