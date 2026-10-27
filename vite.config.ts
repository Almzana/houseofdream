import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173 },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: { three: ['three'], react: ['react', 'react-dom'] } } },
  },
  test: { environment: 'node' },
} as never);
