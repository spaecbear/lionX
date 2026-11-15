/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: { output: { manualChunks: { xterm: ['@xterm/xterm', '@xterm/addon-fit'] } } },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: { include: ['src/engine/**'], exclude: ['src/**/*.test.ts'] },
  },
});
