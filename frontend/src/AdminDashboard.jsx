import { useState, useEffect } from 'react';
import {
  getAdminDashboardStats,
  getAdminAuditLogs,
  getScheduledReports,
  createScheduledReport,
  deleteScheduledReport,
  logoutAll,
} from './api.js';
import { showToast } from './main.jsx';

export default function AdminDashboard({ currentUser }) {
  const [stats, setStats] = useState(null);
  const [tableCounts, setTableCounts] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState('overview'); // 'overview' | 'audit' | 'schedules' | 'security'

  // New schedule form state
  const [newTitle, setNewTitle] = useState('');
  const [newReportType, setNewReportType] = useState('statement');
  const [newCron, setNewCron] = useState('0 9 * * 1-5'); // weekdays at 9am

  const loadAll = async () => {
    setLoading(true);
    try {
      const [statsRes, auditRes, schedRes] = await Promise.all([
        getAdminDashboardStats(),
        getAdminAuditLogs(50),
        getScheduledReports(),
      ]);

      if (statsRes.ok) {
        setStats(statsRes.body?.stats || {});
        setTableCounts(statsRes.body?.tableCounts || []);
      }
      if (auditRes.ok) {
        setAuditLogs(auditRes.body?.logs || []);
      }
      if (schedRes.ok) {
        setSchedules(schedRes.body?.reports || []);
      }
    } catch (e) {
      showToast(`Error loading dashboard: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleCreateSchedule = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      showToast('Please provide a report title', 'error');
      return;
    }
    try {
      const res = await createScheduledReport({
        title: newTitle.trim(),
        report_type: newReportType,
        cron_expression: newCron,
      });
      if (res.ok) {
        showToast('Scheduled report created successfully', 'success');
        setNewTitle('');
        setSchedules((prev) => [res.body.report, ...prev]);
      } else {
        showToast(res.body?.error || 'Failed to create schedule', 'error');
      }
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleDeleteSchedule = async (id) => {
    if (!window.confirm('Delete this scheduled report job?')) return;
    try {
      const res = await deleteScheduledReport(id);
      if (res.ok) {
        showToast('Schedule deleted', 'success');
        setSchedules((prev) => prev.filter((s) => s.id !== id));
      }
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleLogoutAllSessions = async () => {
    if (!window.confirm('Terminate all active sessions for your administrator account across all browsers?')) return;
    try {
      const res = await logoutAll();
      if (res.ok) {
        showToast('All active sessions revoked. Please log in again.', 'info');
        window.location.reload();
      }
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  // Max table count for relative chart bar width
  const maxCount = Math.max(1, ...tableCounts.map((t) => Number(t.count) || 0));

  return (
    <div className="lm-page">
      {/* ── Header ── */}
      <div className="lm-header-bar">
        <div>
          <h1 className="lm-page-title">🛡️ Admin Command Dashboard</h1>
          <p className="lm-page-subtitle">
            System health metrics, database distribution graphs, audit trails, and scheduled automation.
          </p>
        </div>
        <button
          type="button"
          className="lm-btn-secondary"
          onClick={loadAll}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : '🔄 Refresh Metrics'}
        </button>
      </div>

      {/* ── Sub Tabs ── */}
      <div className="lp-mode-tabs" style={{ maxWidth: 650, margin: '0 0 20px' }}>
        <button
          type="button"
          className={`lp-mode-tab ${activeSubTab === 'overview' ? 'lp-mode-tab--active' : ''}`}
          onClick={() => setActiveSubTab('overview')}
        >
          📊 System Metrics
        </button>
        <button
          type="button"
          className={`lp-mode-tab ${activeSubTab === 'audit' ? 'lp-mode-tab--active' : ''}`}
          onClick={() => setActiveSubTab('audit')}
        >
          📜 Audit Logs
        </button>
        <button
          type="button"
          className={`lp-mode-tab ${activeSubTab === 'schedules' ? 'lp-mode-tab--active' : ''}`}
          onClick={() => setActiveSubTab('schedules')}
        >
          ⏰ Scheduled Reports
        </button>
        <button
          type="button"
          className={`lp-mode-tab ${activeSubTab === 'security' ? 'lp-mode-tab--active' : ''}`}
          onClick={() => setActiveSubTab('security')}
        >
          🔐 Security
        </button>
      </div>

      {/* ── Tab 1: Overview & Graphs ── */}
      {activeSubTab === 'overview' && (
        <>
          {/* KPI Stat Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            <div className="lm-card" style={{ padding: '20px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase' }}>Total Users</div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--accent)', marginTop: '4px' }}>
                {stats?.total_users ?? '—'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--ink-4)', marginTop: '4px' }}>
                {stats?.active_count ?? 0} active · {stats?.deactivated_count ?? 0} deactivated
              </div>
            </div>

            <div className="lm-card" style={{ padding: '20px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase' }}>2FA Protected Accounts</div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--ok)', marginTop: '4px' }}>
                {stats?.totp_count ?? '—'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--ink-4)', marginTop: '4px' }}>
                TOTP Authenticator enabled
              </div>
            </div>

            <div className="lm-card" style={{ padding: '20px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase' }}>System Administrators</div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: '#f59e0b', marginTop: '4px' }}>
                {stats?.admin_count ?? '—'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--ink-4)', marginTop: '4px' }}>
                Privileged access tier
              </div>
            </div>

            <div className="lm-card" style={{ padding: '20px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase' }}>Database Tables</div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--ink)', marginTop: '4px' }}>
                {tableCounts.length}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--ink-4)', marginTop: '4px' }}>
                Connected PostgreSQL DB
              </div>
            </div>
          </div>

          {/* Graphical Data Distribution */}
          <div className="lm-card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ink)', marginBottom: '16px' }}>
              📈 PostgreSQL Table Record Volume (Live Chart)
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {tableCounts.map((tc) => {
                const pct = Math.round((Number(tc.count) / maxCount) * 100);
                return (
                  <div key={tc.name} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 90px', gap: '12px', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tc.name}>
                      {tc.name}
                    </span>
                    <div style={{ height: '22px', background: 'var(--surface-alt)', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                      <div
                        style={{
                          width: `${Math.max(pct, 2)}%`,
                          height: '100%',
                          background: 'linear-gradient(90deg, #2563eb, #3b82f6)',
                          borderRadius: '5px',
                          transition: 'width 0.4s ease',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--ink-2)', textAlign: 'right' }}>
                      {Number(tc.count).toLocaleString()} rows
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Tab 2: Audit Logs ── */}
      {activeSubTab === 'audit' && (
        <div className="lm-card lm-results-card">
          <div className="lm-results-header">
            <span className="lm-results-title">📜 Security Audit Log Trail</span>
            <span className="lm-pill">{auditLogs.length} events</span>
          </div>

          <div className="lm-table-scroll">
            <table className="lm-table">
              <thead>
                <tr>
                  <th style={{ width: '170px' }}>Timestamp</th>
                  <th style={{ width: '180px' }}>Event</th>
                  <th style={{ width: '140px' }}>Actor</th>
                  <th style={{ width: '140px' }}>Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ fontSize: '12px', color: 'var(--ink-3)' }}>
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td>
                      <span className={`lm-badge ${log.event_type.includes('FAIL') || log.event_type.includes('DELETE') ? 'lm-badge-err' : log.event_type.includes('SUCCESS') ? 'lm-badge-ok' : 'lm-badge-warn'}`}>
                        {log.event_type}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{log.actor || 'system'}</td>
                    <td>{log.target || '—'}</td>
                    <td style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--ink-2)' }}>
                      {log.details ? JSON.stringify(log.details) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab 3: Scheduled Reports ── */}
      {activeSubTab === 'schedules' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Create Form Card */}
          <div className="lm-card" style={{ padding: '20px 24px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)', marginBottom: '14px' }}>
              ➕ Create Recurring Scheduled Report
            </h2>
            <form onSubmit={handleCreateSchedule} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', alignItems: 'flex-end' }}>
              <div className="lm-field">
                <label className="lm-label">Report Job Title</label>
                <input
                  type="text"
                  placeholder="e.g. Daily Transaction Digest"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  required
                />
              </div>

              <div className="lm-field">
                <label className="lm-label">Report Type</label>
                <select
                  value={newReportType}
                  onChange={(e) => setNewReportType(e.target.value)}
                >
                  <option value="statement">Statement</option>
                  <option value="transaction">Transaction</option>
                  <option value="account_summary">Account Summary</option>
                </select>
              </div>

              <div className="lm-field">
                <label className="lm-label">Cron Expression</label>
                <input
                  type="text"
                  placeholder="0 9 * * 1-5"
                  value={newCron}
                  onChange={(e) => setNewCron(e.target.value)}
                  title="Standard 5-part cron syntax"
                />
              </div>

              <button type="submit" className="lm-btn-primary" style={{ height: '42px' }}>
                Schedule Job
              </button>
            </form>
          </div>

          {/* Scheduled Table */}
          <div className="lm-card lm-results-card">
            <div className="lm-results-header">
              <span className="lm-results-title">Active Recurring Report Schedules</span>
              <span className="lm-pill">{schedules.length} configured</span>
            </div>

            <div className="lm-table-scroll">
              <table className="lm-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Cron Schedule</th>
                    <th>Status</th>
                    <th>Created By</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.title}</td>
                      <td><code>{s.report_type}</code></td>
                      <td><code>{s.cron_expression}</code></td>
                      <td>
                        <span className="lm-badge lm-badge-ok">{s.status}</span>
                      </td>
                      <td>{s.created_by || 'Admin'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="lm-btn-row-action lm-btn-admin-danger"
                          onClick={() => handleDeleteSchedule(s.id)}
                          title="Delete schedule"
                        >
                          🗑️ Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {schedules.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--ink-4)' }}>
                        No recurring report jobs scheduled yet. Create one above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 4: Security Actions ── */}
      {activeSubTab === 'security' && (
        <div className="lm-card" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ink)', marginBottom: '8px' }}>
            🔐 Portal Session & Access Security
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--ink-3)', marginBottom: '20px' }}>
            Global session revocation, administrator credentials oversight, and authentication parameters.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '520px' }}>
            <div style={{ padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--surface-alt)' }}>
              <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>
                Revoke All Active Sessions
              </div>
              <p style={{ fontSize: '12.5px', color: 'var(--ink-3)', margin: '0 0 12px' }}>
                Forces immediate sign-out across all other browsers and devices for your administrator account.
              </p>
              <button
                type="button"
                className="lm-btn-row-action lm-btn-admin-danger"
                onClick={handleLogoutAllSessions}
              >
                🚪 Revoke All Active Sessions
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
