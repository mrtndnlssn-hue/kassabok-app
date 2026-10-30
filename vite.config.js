import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Electron laddar index.html som en lokal fil, så vi behöver relativa sökvägar
  base: './',
  build: {
    outDir: 'dist',
  },
})
