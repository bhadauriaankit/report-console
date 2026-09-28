export default function FilterPanel({
  reportTypes = [],
  statuses = [],
  selectedReportType,
  selectedStatus,
  onReportTypeChange,
  onStatusChange,
  onFetch,
  loading,
}) {
  return (
    <section className="panel filters">
      <div className="filters-grid">
        <div className="field">
          <label htmlFor="reportType">Report type</label>
          <select
            id="reportType"
            value={selectedReportType}
            onChange={(e) => onReportTypeChange(e.target.value)}
            disabled={loading || reportTypes.length === 0}
          >
            {reportTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="status">Status</label>
          <select
            id="status"
            value={selectedStatus}
            onChange={(e) => onStatusChange(e.target.value)}
            disabled={loading}
          >
            <option value="">All</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="filters-footer">
        <button
          className="btn btn-primary"
          onClick={onFetch}
          disabled={loading || !selectedReportType}
        >
          {loading ? 'Fetching…' : 'Fetch'}
        </button>
      </div>
    </section>
  );
}
