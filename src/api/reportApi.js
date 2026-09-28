export async function fetchConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) {
    throw new Error(`Failed to load config: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchReport({ reportType, status }) {
  const res = await fetch('/api/reports/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportType, status: status || '' }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || `Request failed with status ${res.status}`);
  }

  return body;
}
