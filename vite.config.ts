
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
      // 之後您只要在 Vercel 後台的 Environment Variables 填入 API_KEY
      // 程式碼就會自動抓取，完全不需要寫在檔案裡
      'process.env.API_KEY': JSON.stringify(env.API_KEY || process.env.API_KEY || '')
    }
  }
})
