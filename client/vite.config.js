import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api and /socket.io are proxied to the Express server on :5000
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/socket.io': { target: 'http://localhost:5000', ws: true },
    },
  },
});
