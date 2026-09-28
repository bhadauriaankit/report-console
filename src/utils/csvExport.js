// Builds a CSV file from the current results and triggers a browser download.
// No server round-trip needed since the rows are already loaded client-side.

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export function downloadCsv({ filename, headers, columns, rows }) {
  const lines = [headers.map(csvEscape).join(',')];

  rows.forEach((row) => {
    const line = columns.map((col) => csvEscape(row[col])).join(',');
    lines.push(line);
  });

  const csvContent = lines.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
