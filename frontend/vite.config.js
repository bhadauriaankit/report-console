import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api/* is forwarded to the backend, so the browser sees one origin
// and no CORS setup is needed. Change the target if your backend port differs.
const backend = process.env.BACKEND_URL || 'http://localhost:4000';
const proxy = { '/api': { target: backend, changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 5173, proxy },
});
