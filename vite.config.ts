import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages ではリポジトリ名のサブパスで配信されるため相対パスにする
export default defineConfig({
  base: './',
  plugins: [react()],
})
