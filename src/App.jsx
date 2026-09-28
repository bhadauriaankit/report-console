import { useState, useEffect } from 'react';
import FilterPanel from './components/FilterPanel.jsx';
import ResultsTable from './components/ResultsTable.jsx';
import { fetchConfig, fetchReport } from './api/reportApi.js';

export default function App() {
  const [reportTypes, setReportTypes] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [selectedReportType, setSelectedReportType] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const cfg = await fetchConfig();
        if (cfg.reportTypes && cfg.reportTypes.length > 0) {
          setReportTypes(cfg.reportTypes);
          setSelectedReportType(cfg.reportTypes[0]);
        }
        if (cfg.statuses) {
          setStatuses(cfg.statuses);
        }
      } catch (err) {
        setErrorMessage('Failed to load config: ' + err.message);
      }
    }
    load();
  }, []);

  async function handleFetch() {
    setRows([]);
    setErrorMessage('');
    setLoading(true);
    setHasSearched(false);

    try {
      const response = await fetchReport({
        reportType: selectedReportType,
        status: selectedStatus,
      });

      setHasSearched(true);
      if (response.status === 'SUCCESS' || (!response.status && Array.isArray(response.data))) {
        setRows(Array.isArray(response.data) ? response.data : []);
      } else {
        setErrorMessage(response.errorMessage || `Error: ${response.status || 'Failed'}`);
      }
    } catch (err) {
      setHasSearched(true);
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wrap">
      <header className="page-head">
        <h1>Reports</h1>
      </header>

      <FilterPanel
        reportTypes={reportTypes}
        statuses={statuses}
        selectedReportType={selectedReportType}
        selectedStatus={selectedStatus}
        onReportTypeChange={setSelectedReportType}
        onStatusChange={setSelectedStatus}
        onFetch={handleFetch}
        loading={loading}
      />

      {errorMessage && <div className="status-row error">{errorMessage}</div>}

      <ResultsTable
        reportType={selectedReportType}
        rows={rows}
        loading={loading}
        hasSearched={hasSearched}
      />
    </div>
  );
}
