
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // 這裡會自動幫您檢查是否有設定環境變數
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    define: {
      // 這裡設定好「通道」
      // 既然 API_KEY 被佔用，我們改用 GEMINI_API_KEY
      // 程式碼就會自動抓取 Vercel 後台設定的 GEMINI_API_KEY
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '')
    }
  }
})
