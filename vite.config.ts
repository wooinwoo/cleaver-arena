import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:3186', ws: true },
      '/table-ws': { target: 'ws://127.0.0.1:3186', ws: true },
      '/lobby-ws': { target: 'ws://127.0.0.1:3186', ws: true },
      '/bumper-ws': { target: 'ws://127.0.0.1:3186', ws: true },
      '/api': 'http://127.0.0.1:3186',
    },
  },
  build: { chunkSizeWarningLimit: 1600 },
});
