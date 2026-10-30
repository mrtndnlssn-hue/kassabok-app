import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // Electron laddar index.html som en lokal fil, så vi behöver relativa sökvägar
  base: './',
  build: {
    outDir: 'dist',
  },
})
