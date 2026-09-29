export default function ResultTable({ rows }) {
  if (!rows || rows.length === 0) return null;

  const columns = Object.keys(rows[0]);
  const label   = (c) => c.replace(/_/g, ' ');

  const cellValue = (col, val) => {
    if (col === 'status') {
      return (
        <span className={`pill ${String(val).toLowerCase()}`}>
          {String(val)}
        </span>
      );
    }
    return String(val ?? '—');
  };

  return (
    <div className="table-card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{label(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c}>{cellValue(c, row[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
