import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReportConsole from './ReportConsole.jsx';
import LiveMonitor from './LiveMonitor.jsx';
import './styles.css';

const TABS = [
  { id: 'monitor', label: '🟢 Live Monitor' },
  { id: 'report',  label: '📊 Scaler Reports' },
];

function App() {
  const [tab, setTab] = useState('monitor');

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
      {tab === 'monitor' && <LiveMonitor />}
      {tab === 'report'  && <ReportConsole />}
    </>
  );
}


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
