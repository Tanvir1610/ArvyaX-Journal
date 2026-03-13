import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // Proxy only used in local dev (when VITE_API_URL is not set)
    proxy: {
      '/api': {
        target: 'https://arvyax-journal.onrender.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
