// Empty in dev (Vite proxy). Set VITE_API_URL for a separate deployment.
export const API = import.meta.env.VITE_API_URL || '';

async function json(res) {
  let body = null;
  try { body = await res.json(); } catch { /* empty body */ }
  return { ok: res.ok, status: res.status, body };
}

export const getConfig = () => fetch(`${API}/api/config`).then(json);

export const sendRequest = (payload) =>
  fetch(`${API}/api/reports/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json);

/**
 * Build and send a report request with the full filter set.
 */
export const fetchReportData = (requestId, reportType, status, datePreset, dateFrom, dateTo) => {
  const payload = { requestId, reportType };
  if (status)     payload.status     = status;
  if (datePreset) payload.datePreset = datePreset;
  if (dateFrom)   payload.dateFrom   = dateFrom;
  if (dateTo)     payload.dateTo     = dateTo;
  return fetch(`${API}/api/reports/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json);
};

export const getResult = (requestId) =>
  fetch(`${API}/api/results/${encodeURIComponent(requestId)}`).then(json);

export const eventsUrl = `${API}/api/events`;

// ── PostgreSQL Live Monitor helpers ──
export const getPgTables = () => fetch(`${API}/api/pg/tables`, { credentials: 'include' }).then(json);

export const getPgRows = (table, options = {}) => {
  const params = new URLSearchParams({ table });
  if (options.limit)      params.set('limit', String(options.limit));
  if (options.dateFrom)   params.set('dateFrom', options.dateFrom);
  if (options.dateTo)     params.set('dateTo', options.dateTo);
  if (options.datePreset) params.set('datePreset', options.datePreset);
  if (options.status)     params.set('status', options.status);
  return fetch(`${API}/api/pg/rows?${params.toString()}`, { credentials: 'include' }).then(json);
};

export const getPgFileUrl = (filePath, download = false) =>
  `${API}/api/pg/file?path=${encodeURIComponent(filePath)}${download ? '&download=1' : ''}`;

export const pgStreamUrl = (table) =>
  `${API}/api/pg/stream?table=${encodeURIComponent(table)}`;

// ── Auth helpers ──
export const getMe = () =>
  fetch(`${API}/api/auth/me`, { credentials: 'include' }).then(json);

export const loginAdmin = (username, password) =>
  fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  }).then(json);

export const logout = () =>
  fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' }).then(json);

export const microsoftLoginUrl = `${API}/api/auth/microsoft`;


