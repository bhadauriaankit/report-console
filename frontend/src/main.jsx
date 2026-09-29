import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ReportConsole from './ReportConsole.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ReportConsole />
  </StrictMode>
);
