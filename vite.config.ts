import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { applicationPwaPlugin } from './server/pwaBuild.ts'
import { salonNeonApiPlugin } from './server/viteApiPlugin.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), salonNeonApiPlugin(), applicationPwaPlugin()],
  resolve: {
    alias: {
      cn: path.resolve(__dirname, './src/lib/utils.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
})
