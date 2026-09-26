import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  // Production builds must know where the API lives: the dev fallback (`<page host>:8000`) is wrong behind a
  // reverse proxy / TLS. Opt out explicitly with VITE_ALLOW_SAME_HOST_API=true (e.g. API really on :8000 of the same host).
  if (command === 'build' && mode === 'production' && !(env.VITE_API_BASE_URL ?? '').trim() && env.VITE_ALLOW_SAME_HOST_API !== 'true') {
    throw new Error(
      'VITE_API_BASE_URL is empty. Set it to the backend origin for production builds (e.g. VITE_API_BASE_URL=https://api.example.com), ' +
        'or set VITE_ALLOW_SAME_HOST_API=true to keep the "<page host>:8000" fallback on purpose.',
    )
  }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5173, strictPort: true },
    build: {
      chunkSizeWarningLimit: 900,
    },
  }
})
