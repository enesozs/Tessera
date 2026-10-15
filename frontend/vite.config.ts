import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    // FastAPI runs on API_PORT (default 8010) during development; the browser only talks to Vite.
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 8010}` },
  },
  build: {
    // ECharts is one ~550 kB chunk even tree-shaken; it is cached separately from the app.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Charting libraries change rarely; keep them out of the app chunk for caching.
        manualChunks: (id) =>
          id.includes('node_modules/echarts') || id.includes('node_modules/zrender')
            ? 'echarts'
            : id.includes('node_modules/lightweight-charts')
              ? 'lwc'
              : undefined,
      },
    },
  },
})
