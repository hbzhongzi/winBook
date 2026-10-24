import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // vendor 拆分：react/epubjs/pdfjs 各自独立 chunk，避免单包 >500kB 拖慢首屏
        manualChunks: {
          react: ["react", "react-dom"],
          epubjs: ["epubjs"],
          pdfjs: ["pdfjs-dist"],
        },
      },
    },
  },
})
