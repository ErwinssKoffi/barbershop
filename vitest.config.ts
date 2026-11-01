import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      cn: path.resolve(__dirname, './src/lib/utils.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // PGlite/WASM + real password hashing are CPU-heavy: avoid competing workers
    // on small CI runners. Keep isolated databases and the existing 5s test budget.
    maxWorkers: 1,
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
