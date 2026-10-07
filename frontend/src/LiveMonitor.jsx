import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { getPgTables, getPgRows, pgStreamUrl, getPgFileUrl } from './api.js';
import MediaModal from './MediaModal.jsx';
import './LiveMonitor.css';

/* ── Helpers ── */
const toLabel = (key) =>
  key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Today as "yyyy-mm-dd" in local timezone */
const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Status badge color class */
const statusClass = (val) => {
  const v = String(val).toLowerCase().replace(/\s+/g, '_');
  if (v === 'complete' || v === 'success' || v === 'active' || v === 'paid') return 'lm-badge-ok';
  if (v === 'failed' || v === 'error' || v === 'inactive' || v === 'cancelled') return 'lm-badge-err';
  if (v === 'pending' || v === 'in_progress' || v === 'processing') return 'lm-badge-warn';
  return 'lm-badge-neutral';
};

/* ── Content Detectors ── */
function analyzeHtml(val, colName = 'html') {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;

  const colLower = String(colName).toLowerCase();
  const isLikelyHtmlCol = /html|template|markup/i.test(colLower);

  // 1. File path to HTML (e.g. E:/.../statement.html or path in an HTML column)
  const isPathLike = (s.includes('/') || s.includes('\\')) && !s.includes('<');
  if (/\.(html?)$/i.test(s) || (isLikelyHtmlCol && isPathLike)) {
    const filename = s.replace(/\\/g, '/').split('/').pop() || `${colName}.html`;
    return {
      kind: 'path',
      type: 'html',
      path: s,
      filename: filename.endsWith('.html') || filename.endsWith('.htm') ? filename : `${filename}.html`,
    };
  }

  // 2. URL to HTML
  if (s.startsWith('http://') || s.startsWith('https://')) {
    if (isLikelyHtmlCol || /\.(html?)(\?|$)/i.test(s)) {
      const filename = s.split('/').pop().split('?')[0] || `${colName}.html`;
      return { kind: 'url', type: 'html', url: s, filename };
    }
  }

  // 3. Data URI
  if (s.startsWith('data:text/html')) {
    let content = s;
    if (s.startsWith('data:text/html;base64,')) {
      try { content = atob(s.split(',')[1]); } catch (_) {}
    } else {
      try { content = decodeURIComponent(s.split(',')[1]); } catch (_) {}
    }
    return { kind: 'html', type: 'html', content, filename: `${colName}.html` };
  }

  // 4. Base64 encoded HTML string
  if (/^[A-Za-z0-9+/=]{20,}$/.test(s) && !s.includes('<')) {
    try {
      const decoded = atob(s);
      if (/<[a-z][\s\S]*>/i.test(decoded)) {
        return { kind: 'html', type: 'html', content: decoded, filename: `${colName}.html` };
      }
    } catch (_) {}
  }

  // 5. Raw HTML string or HTML column
  if (isLikelyHtmlCol || s.startsWith('<!DOCTYPE html') || s.startsWith('<html') || s.startsWith('<div') || (s.includes('</') && /<[a-z][\s\S]*>/i.test(s))) {
    return { kind: 'html', type: 'html', content: s, filename: `${colName}.html` };
  }

  return null;
}

function analyzeAttachment(val, colName = 'attachment') {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;

  const colLower = String(colName).toLowerCase();
  const isLikelyAttachCol = /attach|file|doc|pdf|media|upload|image|blob/i.test(colLower);

  // 1. Data URI
  if (s.startsWith('data:')) {
    const [meta] = s.split(',');
    const mime = meta.split(';')[0].replace('data:', '');
    let type = 'file';
    let ext = 'bin';
    if (mime.includes('pdf')) { type = 'pdf'; ext = 'pdf'; }
    else if (mime.startsWith('image/')) { type = 'image'; ext = mime.split('/')[1] || 'png'; }
    else if (mime.includes('html')) { type = 'html'; ext = 'html'; }
    else if (mime.includes('text')) { type = 'text'; ext = 'txt'; }
    return { kind: 'data-uri', mime, type, ext, dataUri: s, filename: `${colName}.${ext}` };
  }

  // 2. Base64
  if (/^[A-Za-z0-9+/=]{30,}$/.test(s) && !s.includes('/') && !s.includes('\\')) {
    if (s.startsWith('JVBERi0')) {
      return { kind: 'base64', mime: 'application/pdf', type: 'pdf', ext: 'pdf', dataUri: `data:application/pdf;base64,${s}`, filename: `${colName}.pdf` };
    }
    if (s.startsWith('iVBORw0KG')) {
      return { kind: 'base64', mime: 'image/png', type: 'image', ext: 'png', dataUri: `data:image/png;base64,${s}`, filename: `${colName}.png` };
    }
    if (s.startsWith('/9j/')) {
      return { kind: 'base64', mime: 'image/jpeg', type: 'image', ext: 'jpg', dataUri: `data:image/jpeg;base64,${s}`, filename: `${colName}.jpg` };
    }
    if (s.startsWith('R0lGOD')) {
      return { kind: 'base64', mime: 'image/gif', type: 'image', ext: 'gif', dataUri: `data:image/gif;base64,${s}`, filename: `${colName}.gif` };
    }
    if (s.startsWith('UklGR')) {
      return { kind: 'base64', mime: 'image/webp', type: 'image', ext: 'webp', dataUri: `data:image/webp;base64,${s}`, filename: `${colName}.webp` };
    }
    if (isLikelyAttachCol) {
      return { kind: 'base64', mime: 'application/octet-stream', type: 'file', ext: 'bin', dataUri: `data:application/octet-stream;base64,${s}`, filename: `${colName}.bin` };
    }
  }

  // 3. URL
  if (s.startsWith('http://') || s.startsWith('https://')) {
    const lower = s.toLowerCase();
    let type = 'file';
    if (lower.endsWith('.pdf') || lower.includes('.pdf?')) type = 'pdf';
    else if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(lower)) type = 'image';
    else if (/\.(html?|txt)(\?|$)/i.test(lower)) type = 'text';
    const filename = s.split('/').pop().split('?')[0] || `${colName}.file`;
    return { kind: 'url', type, url: s, filename };
  }

  // 4. File Path
  if (/\.(pdf|png|jpe?g|gif|webp|svg|docx?|xlsx?|csv|txt|html?|zip)(\s*$|\?)/i.test(s) || (isLikelyAttachCol && (s.includes('/') || s.includes('\\')))) {
    const lower = s.toLowerCase();
    let type = 'file';
    if (lower.endsWith('.pdf')) type = 'pdf';
    else if (/\.(png|jpe?g|gif|webp|svg)$/i.test(lower)) type = 'image';
    else if (/\.(html?)$/i.test(lower)) type = 'html';
    else if (/\.(txt|json|csv)$/i.test(lower)) type = 'text';
    const filename = s.replace(/\\/g, '/').split('/').pop() || `${colName}.file`;
    return { kind: 'path', type, path: s, filename };
  }

  return null;
}

/* ── Icons ── */
const IconDatabase = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
  </svg>
);

const IconRefresh = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
    <polyline points="23 4 23 10 17 10"/>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
);

const IconWifi = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
    <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
    <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
    <line x1="12" y1="20" x2="12.01" y2="20"/>
  </svg>
);

const IconEye = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const IconDownload = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

const IconSearch = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

/* ── Export helpers ── */
function exportCSV(columns, rows, tableName) {
  const escape = (v) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const header = columns.map(escape).join(',');
  const body = rows.map((row) => columns.map((c) => escape(row[c])).join(',')).join('\n');
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `live_${tableName}_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJSON(rows, tableName) {
  const json = JSON.stringify(rows, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `live_${tableName}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Media Cell Renderer ── */
function MediaCell({ col, val, rowIndex, onPreview, onDownload }) {
  if (val === null || val === undefined || val === '') {
    return <span className="lm-val-empty">—</span>;
  }

  // 1. Check if HTML
  const htmlInfo = analyzeHtml(val, `${col}_row${rowIndex + 1}`);
  if (htmlInfo) {
    const mediaObj = {
      title: `${toLabel(col)} #${rowIndex + 1}`,
      ...htmlInfo,
    };

    return (
      <div className="lm-media-cell">
        <span className="lm-media-badge lm-badge-html" title="HTML Document">
          &lt;/&gt; HTML
        </span>
        <div className="lm-media-actions">
          <button
            type="button"
            className="lm-btn-media-icon lm-btn-preview"
            onClick={() => onPreview(mediaObj)}
            title="Preview HTML"
            aria-label="Preview HTML"
          >
            <IconEye />
          </button>
          <button
            type="button"
            className="lm-btn-media-icon lm-btn-download"
            onClick={() => onDownload(mediaObj)}
            title="Download HTML"
            aria-label="Download HTML"
          >
            <IconDownload />
          </button>
        </div>
      </div>
    );
  }

  // 2. Check if Attachment
  const attachInfo = analyzeAttachment(val, `${col}_row${rowIndex + 1}`);
  if (attachInfo) {
    const mediaObj = {
      title: `${toLabel(col)} #${rowIndex + 1}`,
      ...attachInfo,
    };

    return (
      <div className="lm-media-cell">
        <span className={`lm-media-badge lm-badge-${attachInfo.type}`} title={attachInfo.filename}>
          📎 {attachInfo.type.toUpperCase()}
        </span>
        <div className="lm-media-actions">
          <button
            type="button"
            className="lm-btn-media-icon lm-btn-preview"
            onClick={() => onPreview(mediaObj)}
            title="Preview Attachment"
            aria-label="Preview Attachment"
          >
            <IconEye />
          </button>
          <button
            type="button"
            className="lm-btn-media-icon lm-btn-download"
            onClick={() => onDownload(mediaObj)}
            title="Download Attachment"
            aria-label="Download Attachment"
          >
            <IconDownload />
          </button>
        </div>
      </div>
    );
  }

  // 3. Status
  if (col.toLowerCase() === 'status') {
    return <span className={`lm-badge ${statusClass(val)}`}>{String(val)}</span>;
  }

  const str = String(val);
  if (str.length > 70) {
    return <span className="lm-cell-truncate" title={str}>{str}</span>;
  }

  return <span>{str}</span>;
}

/* ── Results Table ── */
function MonitorTable({ rows, newIds, onPreview, onDownload }) {
  if (!rows || rows.length === 0) return null;
  const columns = Object.keys(rows[0]);

  return (
    <div className="lm-table-scroll">
      <table className="lm-table">
        <thead>
          <tr>
            <th className="lm-th-idx">#</th>
            {columns.map((c) => (
              <th key={c}>{toLabel(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={newIds.has(i) ? 'lm-row-new' : ''}>
              <td className="lm-td-idx">{i + 1}</td>
              {columns.map((c) => (
                <td key={c}>
                  <MediaCell
                    col={c}
                    val={row[c]}
                    rowIndex={i}
                    onPreview={onPreview}
                    onDownload={onDownload}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Main LiveMonitor Component ── */
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

  /* ── Date filter & Limit state ── */
  const [dateFrom, setDateFrom]     = useState('');
  const [dateTo, setDateTo]         = useState('');
  const [todayMode, setTodayMode]   = useState(false);
  const [recordLimit, setRecordLimit] = useState(100); // Default to 100
  const [detectedDateCol, setDetectedDateCol] = useState(null);

  /* ── Status filter state ── */
  const [statusFilter, setStatusFilter] = useState('');
  const [statusOptions, setStatusOptions] = useState([]);
  const [detectedStatusCol, setDetectedStatusCol] = useState(null);

  /* ── Table search filter ── */
  const [searchQuery, setSearchQuery] = useState('');


  /* ── Modal preview state ── */
  const [activeMedia, setActiveMedia] = useState(null);

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

  /* ── Fetch latest rows (with limit, status, and date filters) ── */
  const fetchRowsOnly = useCallback(async (isRefresh = false) => {
    if (!table) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const options = {
        limit: recordLimit,
      };

      if (statusFilter) {
        options.status = statusFilter;
      }

      if (todayMode) {
        options.datePreset = 'today';
        const today = getTodayStr();
        options.dateFrom = today;
        options.dateTo = today;
      } else {
        if (dateFrom) options.dateFrom = dateFrom;
        if (dateTo) options.dateTo = dateTo;
      }

      const d = await getPgRows(table, options);
      if (!d.ok) throw new Error(d.body?.error || `HTTP ${d.status}`);

      setRows(d.body.rows || []);
      setDetectedDateCol(d.body.dateColumn || null);
      setDetectedStatusCol(d.body.statusColumn || null);
      if (d.body.statuses?.length) {
        setStatusOptions(d.body.statuses);
      }
      setHasFetched(true);
      setLastRefreshed(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [table, recordLimit, statusFilter, todayMode, dateFrom, dateTo]);


  /* ── Fetch & Start Live SSE Stream ── */
  const handleFetch = useCallback(async () => {
    if (!table) return;
    closeStream();
    setNewIds(new Set());
    setLiveCount(0);

    await fetchRowsOnly(false);

    /* ── Open Real-Time SSE Stream ── */
    const es = new EventSource(pgStreamUrl(table));
    esRef.current = es;

    es.onopen = () => setStreaming(true);

    es.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'insert') {
          setRows((prev) => {
            const next = [msg.row, ...prev].slice(0, recordLimit);
            setNewIds(new Set([0])); // row 0 flashes
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
  }, [table, recordLimit, closeStream, fetchRowsOnly]);

  /* ── Refresh Button ── */
  const handleRefresh = useCallback(() => {
    fetchRowsOnly(true);
  }, [fetchRowsOnly]);

  /* ── Media Download Handler ── */
  const handleDownloadMedia = useCallback((media) => {
    if (!media) return;
    const { kind, dataUri, content, path, url, filename } = media;

    // 1. Data URI / Base64
    if (dataUri) {
      const a = document.createElement('a');
      a.href = dataUri;
      a.download = filename || 'attachment';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    // 2. Raw HTML
    if (kind === 'html' && content) {
      const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename || 'document.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      return;
    }

    // 3. Local Server Path
    if (kind === 'path' && path) {
      const downloadUrl = getPgFileUrl(path, true);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename || 'file';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    // 4. URL
    if (kind === 'url' && url) {
      window.open(url, '_blank');
    }
  }, []);

  /* ── Cleanup on unmount ── */
  useEffect(() => () => closeStream(), [closeStream]);

  /* ── Client-side search filtering ── */
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter((r) =>
      Object.values(r).some((val) =>
        String(val ?? '').toLowerCase().includes(q)
      )
    );
  }, [rows, searchQuery]);

  const busy = loading || refreshing;

  return (
    <div className="lm-page">

      {/* ── Page Header & Top Stats ── */}
      <div className="lm-header-bar">
        <div>
          <h1 className="lm-page-title">Live Database Monitor</h1>
          <p className="lm-page-subtitle">
            Real-time PostgreSQL CDC monitoring, date filtering, HTML rendering & attachment downloads.
          </p>
        </div>

        <div className="lm-stats-badges">
          <span className={`lm-live-badge ${streaming ? 'lm-live-badge--on' : ''}`}>
            <IconWifi />
            {streaming ? `Live SSE · ${liveCount} new` : 'Offline'}
          </span>
          {hasFetched && (
            <span className="lm-stat-pill">
              {rows.length} records (Limit: {recordLimit})
            </span>
          )}
        </div>
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div className="lm-error-banner" role="alert">
          <span>{error}</span>
          <button className="lm-banner-close" onClick={() => setError('')}>✕</button>
        </div>
      )}

      {/* ── Enhanced Control / Filter Card ── */}
      <div className="lm-card lm-filter-card">

        {/* Row 1: Table selection, Limit, Date Filters */}
        <div className="lm-filter-grid">

          {/* Table select */}
          <div className="lm-field">
            <label className="lm-label" htmlFor="lm-table">
              <IconDatabase /> Table
            </label>
            <select
              id="lm-table"
              value={table}
              onChange={(e) => {
                setTable(e.target.value);
                setStatusFilter('');
                setStatusOptions([]);
                setHasFetched(false);
                setRows([]);
              }}
              disabled={busy || !tables.length}
            >
              {tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Status Filter */}
          <div className="lm-field">
            <label className="lm-label" htmlFor="lm-status-filter">
              Status Filter
            </label>
            <select
              id="lm-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              disabled={busy}
            >
              <option value="">All Statuses</option>
              {statusOptions.length > 0
                ? statusOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))
                : (
                  <>
                    <option value="COMPLETE">COMPLETE</option>
                    <option value="FAILED">FAILED</option>
                    <option value="PENDING">PENDING</option>
                    <option value="IN_PROGRESS">IN_PROGRESS</option>
                  </>
                )
              }
            </select>
          </div>

          {/* Record Limit */}
          <div className="lm-field lm-field-limit">
            <label className="lm-label" htmlFor="lm-limit">Records Limit</label>
            <select
              id="lm-limit"
              value={recordLimit}
              onChange={(e) => setRecordLimit(Number(e.target.value))}
              disabled={busy}
            >
              <option value="50">50 rows</option>
              <option value="100">100 rows (Default)</option>
              <option value="200">200 rows</option>
              <option value="500">500 rows</option>
            </select>
          </div>


          {/* Date from */}
          <div className="lm-field">
            <label className="lm-label" htmlFor="lm-date-from">Date From</label>
            <input
              id="lm-date-from"
              type="text"
              inputMode="numeric"
              placeholder="yyyy-mm-dd"
              value={todayMode ? getTodayStr() : dateFrom}
              onChange={(e) => { setTodayMode(false); setDateFrom(e.target.value); }}
              disabled={busy}
              className={todayMode ? 'lm-date-locked' : ''}
              readOnly={todayMode}
            />
          </div>

          {/* Date to */}
          <div className="lm-field">
            <label className="lm-label" htmlFor="lm-date-to">Date To</label>
            <input
              id="lm-date-to"
              type="text"
              inputMode="numeric"
              placeholder="yyyy-mm-dd"
              value={todayMode ? getTodayStr() : dateTo}
              onChange={(e) => { setTodayMode(false); setDateTo(e.target.value); }}
              disabled={busy}
              className={todayMode ? 'lm-date-locked' : ''}
              readOnly={todayMode}
            />
          </div>

          {/* Quick Today Button */}
          <div className="lm-field lm-field-action-btn">
            <label className="lm-label">Quick Date</label>
            <button
              type="button"
              className={`lm-btn-today ${todayMode ? 'lm-btn-today--active' : ''}`}
              onClick={() => setTodayMode((prev) => !prev)}
              disabled={busy}
              title="Filter by Today's date"
            >
              {todayMode ? '📅 Today (Active)' : '📅 Today'}
            </button>
          </div>
        </div>

        {/* Action Row */}
        <div className="lm-action-bar">
          <div className="lm-action-buttons">
            <button
              className="lm-btn-primary"
              onClick={handleFetch}
              disabled={busy || !table}
            >
              {loading ? <span className="lm-spinner" /> : <IconRefresh />}
              {loading ? 'Fetching…' : (hasFetched ? 'Re-fetch Table' : 'Fetch Records')}
            </button>

            {hasFetched && (
              <button
                className="lm-btn-secondary"
                onClick={handleRefresh}
                disabled={busy || !table}
                title="Refresh latest 100 records from PostgreSQL"
              >
                {refreshing ? <span className="lm-spinner" /> : <IconRefresh />}
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            )}

            {(dateFrom || dateTo || todayMode || statusFilter) && (
              <button
                type="button"
                className="lm-btn-text"
                onClick={() => {
                  setTodayMode(false);
                  setDateFrom('');
                  setDateTo('');
                  setStatusFilter('');
                }}
                disabled={busy}
              >
                Clear Filters
              </button>
            )}
          </div>

          <div className="lm-filter-notes">
            {detectedStatusCol && statusFilter && (
              <span className="lm-filter-note">
                Status: <strong>{statusFilter}</strong> ({detectedStatusCol})
              </span>
            )}
            {detectedDateCol && (
              <span className="lm-filter-note">
                Date: <strong>{detectedDateCol}</strong>
              </span>
            )}
          </div>
        </div>
      </div>


      {/* ── Results Section ── */}
      <div className="lm-card lm-results-card">

        {/* Toolbar Header */}
        <div className="lm-results-header">
          <div className="lm-results-header-left">
            <span className="lm-results-title">
              <IconDatabase />
              {hasFetched ? table : 'Table Records'}
            </span>

            {hasFetched && (
              <span className="lm-pill">
                {filteredRows.length} {filteredRows.length === 1 ? 'record' : 'records'}
                {searchQuery && ` (matching "${searchQuery}")`}
              </span>
            )}
          </div>

          {hasFetched && (
            <div className="lm-results-header-right">
              {/* Client search */}
              <div className="lm-search-box">
                <IconSearch />
                <input
                  type="text"
                  placeholder="Filter in results…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="lm-search-clear"
                    onClick={() => setSearchQuery('')}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Export Controls */}
              {rows.length > 0 && (
                <div className="lm-export-btns">
                  <button
                    type="button"
                    className="lm-btn-export"
                    onClick={() => exportCSV(Object.keys(rows[0]), rows, table)}
                    title="Export as CSV"
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    className="lm-btn-export"
                    onClick={() => exportJSON(rows, table)}
                    title="Export as JSON"
                  >
                    JSON
                  </button>
                </div>
              )}

              {lastRefreshed && (
                <span className="lm-refreshed-time" title="Last refreshed time">
                  Updated {lastRefreshed}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Table Body States */}
        {!hasFetched && !loading && (
          <div className="lm-placeholder">
            Select a table and click <strong>Fetch Records</strong> to view up to 100 entries and stream live updates.
          </div>
        )}

        {loading && (
          <div className="lm-placeholder">
            <span className="lm-spinner" /> Loading latest records…
          </div>
        )}

        {hasFetched && !loading && filteredRows.length === 0 && (
          <div className="lm-placeholder lm-empty">
            {searchQuery
              ? `No records match search term "${searchQuery}".`
              : 'No records found matching current date and filters.'}
          </div>
        )}

        {hasFetched && !loading && filteredRows.length > 0 && (
          <MonitorTable
            rows={filteredRows}
            newIds={newIds}
            onPreview={setActiveMedia}
            onDownload={handleDownloadMedia}
          />
        )}
      </div>

      {/* ── Interactive Preview Modal for HTML & Attachments ── */}
      {activeMedia && (
        <MediaModal
          media={activeMedia}
          onClose={() => setActiveMedia(null)}
          onDownload={handleDownloadMedia}
        />
      )}
    </div>
  );
}
