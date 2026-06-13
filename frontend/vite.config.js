import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['.loca.lt', '.ngrok-free.dev', '.pinet.com', '.tunnelmole.net'],
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})