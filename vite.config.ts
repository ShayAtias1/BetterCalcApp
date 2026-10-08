import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The build's short git SHA, for analytics (`app_version`). Hosts that build without a .git
 * directory expose the commit in an env var instead; `unknown` if neither is available.
 */
function appVersion(): string {
  const fromEnv =
    process.env.APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.COMMIT_REF
  if (fromEnv) return fromEnv.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/ai': { target: 'http://127.0.0.1:4781', changeOrigin: true } } },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
})
