import { useEffect, useRef, useState, useCallback } from 'react';
import { getConfig } from './api.js';
import { useReport } from './useReport.js';
import './ReportConsole.css';

/* ─────────────────────────────────────────────
   Fallback options used if the API returns none
───────────────────────────────────────────────*/
const FALLBACK_REPORT_TYPES = ['statement', 'transaction', 'account_summary'];
const FALLBACK_STATUSES = ['Complete', 'Failed', 'Pending', 'In progress'];

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────*/
/** "statement_id" → "Statement ID" */
const toLabel = (key) =>
  key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** Returns today's date as "yyyy-mm-dd" */
const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Status string → badge CSS class */
const statusClass = (val) => {
  const v = String(val).toLowerCase().replace(/\s+/g, '_');
  if (v === 'complete') return 'badge-complete';
  if (v === 'failed') return 'badge-failed';
  if (v === 'pending' || v === 'in_progress') return 'badge-pending';
  return 'badge-neutral';
};

/* ─────────────────────────────────────────────
   SVG Icons (no external deps)
───────────────────────────────────────────────*/
const IconDownload = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

const IconX = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

/* ─────────────────────────────────────────────
   Export helpers
───────────────────────────────────────────────*/
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

function exportCSV(columns, rows, reportType) {
  const csv = rowsToCSV(columns, rows);
  downloadFile(csv, `report_${reportType || 'export'}_${Date.now()}.csv`, 'text/csv;charset=utf-8;');
}

function exportJSON(rows, reportType) {
  const json = JSON.stringify(rows, null, 2);
  downloadFile(json, `report_${reportType || 'export'}_${Date.now()}.json`, 'application/json');
}

/* ─────────────────────────────────────────────
   StatusBadge
───────────────────────────────────────────────*/
function StatusBadge({ value }) {
  return <span className={`rc-badge ${statusClass(value)}`}>{String(value)}</span>;
}

/* ─────────────────────────────────────────────
   ResultsTable
───────────────────────────────────────────────*/
function ResultsTable({ rows }) {
  if (!rows || rows.length === 0) return null;
  const columns = Object.keys(rows[0]);

  return (
    <div className="rc-table-scroll">
      <table className="rc-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{toLabel(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c}>
                  {c.toLowerCase() === 'status'
                    ? <StatusBadge value={row[c]} />
                    : String(row[c] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main component
───────────────────────────────────────────────*/
export default function ReportConsole() {
  /* ── Config state ── */
  const [reportTypes, setReportTypes] = useState([]);
  const [statuses, setStatuses] = useState([]);

  /* ── Filter state ── */
  const [reportType, setReportType] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [todayMode, setTodayMode] = useState(false);


  /* ── UI state ── */
  const [errorBanner, setErrorBanner] = useState('');
  const [hasFetched, setHasFetched] = useState(false);
  const [exportFormat, setExportFormat] = useState('csv');

  /* ── Report hook ── */
  const { run, phase, message, rows, total } = useReport();

  const isLoading = phase === 'waiting';

  /* ── Load config on mount ── */
  useEffect(() => {
    getConfig()
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const types = r.body?.reportTypes?.length
          ? r.body.reportTypes
          : FALLBACK_REPORT_TYPES;
        const sts = r.body?.statuses?.length
          ? r.body.statuses
          : FALLBACK_STATUSES;
        setReportTypes(types);
        setStatuses(sts);
        setReportType(types[0] || '');
      })
      .catch((err) => {
        setReportTypes(FALLBACK_REPORT_TYPES);
        setStatuses(FALLBACK_STATUSES);
        setReportType(FALLBACK_REPORT_TYPES[0]);
        setErrorBanner(`Could not load config: ${err.message}`);
      });
  }, []);

  /* ── Sync API errors into the banner ── */
  useEffect(() => {
    if (phase === 'error' && message) {
      setErrorBanner(message);
    }
  }, [phase, message]);

  /* ── Fetch handler ── */
  const handleFetch = useCallback(() => {
    setErrorBanner('');
    setHasFetched(true);
    if (todayMode) {
      run(reportType, status, 'today', undefined, undefined);
    } else {
      run(reportType, status, undefined, dateFrom || undefined, dateTo || undefined);
    }
  }, [run, reportType, status, todayMode, dateFrom, dateTo]);


  /* ── Export ── */
  const displayRows = rows;
  const displayTotal = total;
  const columns = displayRows.length > 0 ? Object.keys(displayRows[0]) : [];

  const handleExport = () => {
    if (!displayRows.length) return;
    if (exportFormat === 'json') {
      exportJSON(displayRows, reportType);
    } else {
      exportCSV(columns, displayRows, reportType);
    }
  };

  /* ── Pill label ── */
  const pillLabel = `${displayTotal} ${displayTotal === 1 ? 'record' : 'records'}`;

  return (
    <div className="rc-page">

      {/* ── Page header ── */}
      <div className="rc-page-header">
        <h1 className="rc-page-title">Report console</h1>
        <p className="rc-page-subtitle">
          Pick a report type, set filters, fetch matching records.
        </p>
      </div>

      {/* ── Error banner ── */}
      {errorBanner && (
        <div className="rc-error-banner" role="alert">
          <span className="rc-error-text">{errorBanner}</span>
          <button
            className="rc-banner-close"
            aria-label="Dismiss error"
            onClick={() => setErrorBanner('')}
          >
            <IconX />
          </button>
        </div>
      )}

      {/* ── Filter card ── */}
      <div className="rc-card rc-filter-card">

        {/* Row 1: selects + date range */}
        <div className="rc-filter-row">
          <div className="rc-field">
            <label className="rc-label" htmlFor="rc-report-type">Report type</label>
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
            <label className="rc-label" htmlFor="rc-status">Status</label>
            <select
              id="rc-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={isLoading}
            >
              <option value="">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Date from */}
          <div className="rc-field">
            <label className="rc-label" htmlFor="rc-date-from">Date from</label>
            <input
              id="rc-date-from"
              type="text"
              inputMode="numeric"
              value={todayMode ? getTodayStr() : dateFrom}
              onChange={(e) => { setTodayMode(false); setDateFrom(e.target.value); }}
              placeholder="yyyy-mm-dd"
              disabled={isLoading}
              className={todayMode ? 'rc-date-locked' : ''}
              readOnly={todayMode}
            />
          </div>

          {/* Date to */}
          <div className="rc-field">
            <label className="rc-label" htmlFor="rc-date-to">Date to</label>
            <input
              id="rc-date-to"
              type="text"
              inputMode="numeric"
              value={todayMode ? getTodayStr() : dateTo}
              onChange={(e) => { setTodayMode(false); setDateTo(e.target.value); }}
              placeholder="yyyy-mm-dd"
              disabled={isLoading}
              className={todayMode ? 'rc-date-locked' : ''}
              readOnly={todayMode}
            />
          </div>


          {/* Today quick-select */}
          <div className="rc-field rc-field-today">
            <label className="rc-label rc-label-spacer">&nbsp;</label>
            <button
              type="button"
              className={`rc-btn-today${todayMode ? ' rc-btn-today--active' : ''}`}
              onClick={() => setTodayMode((prev) => !prev)}
              disabled={isLoading}
              title={todayMode ? 'Click to switch to a custom date range' : 'Set both dates to today'}
            >
              Today
            </button>
          </div>
        </div>


        {/* Divider + action row */}
        <hr className="rc-divider" />
        <div className="rc-action-row">
          <button
            className="rc-btn-primary"
            onClick={handleFetch}
            disabled={isLoading || !reportType}
          >
            {isLoading ? 'Fetching…' : 'Fetch report'}
          </button>
        </div>
      </div>


      {/* ── Results card ── */}
      <div className="rc-card rc-results-card">

        {/* Results header */}
        <div className="rc-results-header">
          <span className="rc-results-title">Results</span>
          {hasFetched && (
            <div className="rc-results-header-right">
              {/* Export controls – only visible when there are rows */}
              {displayRows.length > 0 && (
                <div className="rc-export-group">
                  <select
                    className="rc-export-select"
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value)}
                    aria-label="Export format"
                  >
                    <option value="csv">CSV</option>
                    <option value="json">JSON</option>
                  </select>
                  <button
                    className="rc-btn-export"
                    onClick={handleExport}
                    title={`Export as ${exportFormat.toUpperCase()}`}
                  >
                    <IconDownload />
                    Export
                  </button>
                </div>
              )}
              <span className="rc-pill">{pillLabel}</span>
            </div>
          )}
        </div>

        {/* Body */}
        {!hasFetched && (
          <div className="rc-placeholder">
            Run a report to see results.
          </div>
        )}

        {hasFetched && isLoading && (
          <div className="rc-placeholder">
            <span className="rc-spinner" />
            Fetching results…
          </div>
        )}

        {hasFetched && !isLoading && displayRows.length === 0 && phase !== 'error' && (
          <div className="rc-placeholder rc-empty">
            No records match your filters.
          </div>
        )}

        {hasFetched && !isLoading && displayRows.length > 0 && (
          <ResultsTable rows={displayRows} />
        )}
      </div>
    </div>
  );
}
