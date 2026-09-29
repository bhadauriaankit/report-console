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
 * @param {string} requestId   - Unique id for SSE/polling correlation.
 * @param {string} reportType  - Required report type key.
 * @param {string} [status]    - Optional status filter; omitted when empty.
 * @param {string} [datePreset]- "today" activates the preset; omit dateFrom/dateTo when set.
 * @param {string} [dateFrom]  - ISO date string (yyyy-mm-dd); omitted when empty.
 * @param {string} [dateTo]    - ISO date string (yyyy-mm-dd); omitted when empty.
 */
export const fetchReportData = (requestId, reportType, status, datePreset, dateFrom, dateTo) => {
  const payload = { requestId, reportType };
  if (status)     payload.status     = status;
  if (datePreset) payload.datePreset = datePreset;
  if (!datePreset && dateFrom) payload.dateFrom = dateFrom;
  if (!datePreset && dateTo)   payload.dateTo   = dateTo;
  return fetch(`${API}/api/reports/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json);
};

export const getResult = (requestId) =>
  fetch(`${API}/api/results/${encodeURIComponent(requestId)}`).then(json);

export const eventsUrl = `${API}/api/events`;
