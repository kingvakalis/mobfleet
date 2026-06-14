import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    dedupe: ['three', '@react-three/fiber', '@react-three/drei'],
  },
  build: {
    // Split the heavy vendor libraries into their own chunks. A single 1MB+
    // chunk (three.js) forces the minify/render pass to hold the whole module
    // graph in memory at once, which OOM-crashes the optimized build on
    // lower-memory machines. Stable vendor chunks keep peak memory + the bundle
    // sizes down (and also cache better across deploys).
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('three') || id.includes('@react-three')) return 'vendor-three'
          if (id.includes('@xyflow')) return 'vendor-reactflow'
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) return 'vendor-motion'
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('react-router') || id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'vendor-react'
        },
      },
    },
  },
  server: {
    // Dev: proxy the API + live socket to the backend so the browser stays
    // same-origin (no CORS). Prod points at VITE_API_URL/VITE_WS_URL instead.
    proxy: {
      '/v1': { target: 'http://localhost:8787', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
})
