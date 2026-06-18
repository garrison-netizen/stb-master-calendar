import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { notionApiPlugin } from './notion-plugin.js'

export default defineConfig({
  plugins: [react(), notionApiPlugin()],
  server: {
    port: 5180,
    strictPort: true,
    host: true,
  },
})
