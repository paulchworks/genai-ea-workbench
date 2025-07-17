import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs-extra'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Copy PDF.js worker to public directory during build
const copyPdfWorker = () => {
  return {
    name: 'copy-pdf-worker',
    buildStart: async () => {
      const workerSrc = path.resolve(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.min.js')
      const destPath = path.resolve(__dirname, 'public/pdf.worker.min.js')
      await fs.copy(workerSrc, destPath)
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), copyPdfWorker()],
  resolve: {
    alias: {
      'pdfjs-dist': path.resolve(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.js'),
    },
  },
})
