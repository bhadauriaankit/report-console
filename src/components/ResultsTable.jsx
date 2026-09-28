import { downloadCsv } from '../utils/csvExport.js';

function Badge({ value }) {
  const str = String(value || '').toUpperCase();
  const cls =
    str === 'COMPLETE' || str === 'SUCCESS'
      ? 'complete'
      : str === 'FAILED' || str === 'ERROR'
      ? 'failed'
      : 'pending';
  return <span className={'badge ' + cls}>{String(value)}</span>;
}

export default function ResultsTable({ reportType, rows, loading, hasSearched }) {
  const columns = rows && rows.length > 0 ? [...new Set(rows.flatMap((r) => Object.keys(r)))] : [];

  function handleDownload() {
    if (!rows || !rows.length) return;
    downloadCsv({
      filename: `${reportType || 'report'}-${new Date().toISOString().slice(0, 10)}.csv`,
      headers: columns,
      columns,
      rows,
    });
  }

  if (!loading && !hasSearched) {
    return null;
  }

  return (
    <section className="panel results">
      <div className="results-head">
        <h2>Results</h2>
        <div className="results-head-actions">
          <span className="count-pill">
            {rows.length} {rows.length === 1 ? 'record' : 'records'}
          </span>
          <button
            className="btn btn-secondary"
            onClick={handleDownload}
            disabled={!rows.length || loading}
          >
            Download CSV
          </button>
        </div>
      </div>

      {loading && (
        <div className="loading-state">
          <div className="spinner" />
          Loading…
        </div>
      )}

      {!loading && hasSearched && rows.length === 0 && (
        <div className="empty-state">No records found.</div>
      )}

      {!loading && rows.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.id || row.statement_id || row.enrollment_id || idx}>
                  {columns.map((col) => (
                    <td key={col}>
                      {col.toLowerCase().includes('status') ? (
                        <Badge value={row[col]} />
                      ) : (
                        String(row[col] ?? '')
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
