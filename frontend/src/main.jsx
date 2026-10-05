import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReportConsole from './ReportConsole.jsx';
import LiveMonitor from './LiveMonitor.jsx';
import './styles.css';

const TABS = [
  { id: 'report',  label: '📊 Report Console' },
  { id: 'monitor', label: '🟢 Live Monitor' },
];

function App() {
  const [tab, setTab] = useState('report');

  return (
    <>
      {/* ── Tab bar ── */}
      <nav className="app-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`app-tab ${tab === t.id ? 'app-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* ── Active view ── */}
      {tab === 'report'  && <ReportConsole />}
      {tab === 'monitor' && <LiveMonitor />}
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
