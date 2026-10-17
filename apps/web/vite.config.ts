/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API = process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/uploads': API,
    },
    allowedHosts: [
      'nnanh.com.vn',
      'stays-leave-passage-jersey.trycloudflare.com'
    ]
  },
  test: { environment: 'node' },
})
