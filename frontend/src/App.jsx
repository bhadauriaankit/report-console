import { useEffect, useState } from 'react';
import { getConfig } from './api.js';
import { useReport } from './useReport.js';
import ResultTable from './ResultTable.jsx';

/* ---- Inline SVG icons (no extra dependency) ---- */
const IconChart = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/>
    <rect x="17" y="3" width="4" height="18" rx="1"/>
  </svg>
);

const IconFilter = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
);

const IconPlay = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>
);

const IconTable = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M3 9h18M9 21V9"/>
  </svg>
);

const IconCheckCircle = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
);

const IconAlertCircle = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);

export default function App() {
  const [reportTypes, setReportTypes] = useState([]);
  const [statuses, setStatuses]       = useState([]);
  const [reportType, setReportType]   = useState('');
  const [status, setStatus]           = useState('');
  const [configError, setConfigError] = useState('');

  const { run, phase, message, rows, total, connected } = useReport();

  useEffect(() => {
    getConfig()
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setReportTypes(r.body.reportTypes);
        setStatuses(r.body.statuses);
        setReportType(r.body.reportTypes[0] || '');
      })
      .catch((err) => setConfigError(`Could not load report options: ${err.message}`));
  }, []);

  const waiting = phase === 'waiting';

  return (
    <div className="page">

      {/* ── Top bar ── */}
      <div className="topbar">
        <div className="topbar-brand">
          <div className="brand-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <div>
            <div className="brand-title">Report Portal</div>
            <div className="brand-subtitle">Powered by Scaler</div>
          </div>
        </div>

        <span className={`conn-badge ${connected ? 'live' : 'offline'}`}
              title="Real-time connection to the backend">
          <span className="conn-dot" />
          {connected ? 'Live' : 'Disconnected'}
        </span>
      </div>

      {/* ── Request card ── */}
      <div className="request-card">
        <div className="card-heading">
          <IconFilter />
          Query Parameters
        </div>

        <div className="controls">
          <div className="field">
            <span className="field-label">Report Type</span>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              disabled={waiting}
            >
              {reportTypes.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>

          <div className="field">
            <span className="field-label">Status Filter</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={waiting}
            >
              <option value="">All statuses</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <button
            className="primary"
            onClick={() => run(reportType, status)}
            disabled={!reportType || waiting}
          >
            {waiting ? <span className="spin" /> : <IconPlay />}
            {waiting ? 'Fetching…' : 'Run Report'}
          </button>
        </div>

        {/* Status feedback */}
        {configError && (
          <div className="status-strip err">
            <IconAlertCircle />
            {configError}
          </div>
        )}
        {waiting && (
          <div className="status-strip waiting">
            <span className="spin" />
            {message}
          </div>
        )}
        {phase === 'error' && (
          <div className="status-strip err">
            <IconAlertCircle />
            {message}
          </div>
        )}
        {phase === 'done' && total === 0 && (
          <div className="status-strip info">
            <IconCheckCircle />
            No records match this report type and status filter.
          </div>
        )}
        {phase === 'done' && total > 0 && (
          <div className="status-strip ok">
            <IconCheckCircle />
            {total} record{total === 1 ? '' : 's'} returned successfully.
          </div>
        )}
      </div>

      {/* ── Results ── */}
      {phase === 'done' && (
        <div className="results-section">
          <div className="results-header">
            <span className="results-title">
              <IconTable />
              Results
            </span>
            {rows.length > 0 && (
              <span className="record-badge">{total} record{total === 1 ? '' : 's'}</span>
            )}
          </div>

          {rows.length > 0
            ? <ResultTable rows={rows} />
            : (
              <div className="table-card">
                <div className="empty-state">
                  <IconChart />
                  <p>No data to display</p>
                  <small>Try adjusting your filters and running the report again.</small>
                </div>
              </div>
            )
          }
        </div>
      )}
    </div>
  );
}
