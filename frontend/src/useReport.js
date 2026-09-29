import { useCallback, useEffect, useRef, useState } from 'react';
import { eventsUrl, fetchReportData, getResult } from './api.js';


const TIMEOUT_MS = 60000;
const POLL_MS = 3000;

const newId = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : `r-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Sends { reportType, status } to the backend, then waits for Scaler's answer
// (pushed over SSE, with polling as a backup) and matches it by requestId.
export function useReport() {
  const [phase, setPhase] = useState('idle'); // idle | waiting | done | error
  const [message, setMessage] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [connected, setConnected] = useState(false);

  const currentId = useRef(null);
  const timer = useRef(null);
  const poll = useRef(null);

  const stopWaiting = useCallback(() => {
    clearTimeout(timer.current);
    clearInterval(poll.current);
    currentId.current = null;
  }, []);

  const finish = useCallback((e) => {
    stopWaiting();
    if (e.status !== 'SUCCESS') {
      setPhase('error');
      setMessage(e.errorMessage || `Scaler returned ${e.status}`);
      return;
    }
    setRows(e.data || []);
    setTotal(e.totalRecords ?? (e.data || []).length);
    setPhase('done');
    setMessage('');
  }, [stopWaiting]);

  const fail = useCallback((text) => {
    stopWaiting();
    setPhase('error');
    setMessage(text);
  }, [stopWaiting]);

  // Live stream from the backend. Only events for the current request are used.
  useEffect(() => {
    const es = new EventSource(eventsUrl);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (!currentId.current || e.requestId !== currentId.current) return;
      if (e.type === 'callback') finish(e);
      else if (e.type === 'error') fail(e.message);
    };
    return () => { es.close(); clearTimeout(timer.current); clearInterval(poll.current); };
  }, [finish, fail]);

  const run = useCallback(async (reportType, status, datePreset, dateFrom, dateTo) => {
    stopWaiting();
    setRows([]);
    setTotal(0);
    setPhase('waiting');
    setMessage('Waiting for Scaler…');

    // Create the id first: Scaler can answer before the POST below returns.
    const requestId = newId();
    currentId.current = requestId;

    try {
      const r = await fetchReportData(requestId, reportType, status, datePreset, dateFrom, dateTo);
      if (!r.ok) return fail(r.body?.error || `Request failed (HTTP ${r.status})`);
    } catch (err) {
      return fail(`Could not reach the backend: ${err.message}`);
    }
    if (currentId.current !== requestId) return; // already finished via the stream

    const check = async () => {
      try {
        const x = await getResult(requestId);
        if (x.ok && currentId.current === requestId) finish(x.body);
      } catch { /* try again on the next tick */ }
    };
    check();
    poll.current = setInterval(check, POLL_MS);
    timer.current = setTimeout(
      () => fail('No response from Scaler after 60 seconds.'),
      TIMEOUT_MS
    );
  }, [stopWaiting, finish, fail]);


  return { run, phase, message, rows, total, connected };
}
