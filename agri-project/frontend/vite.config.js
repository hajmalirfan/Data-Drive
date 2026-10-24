import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Security headers for the dev/preview servers. Production hosting must send the
// same headers (see SECURITY.md); the CSP is also embedded in the built index.html.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(self), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

function contentSecurityPolicy(apiUrl) {
  const api = new URL(apiUrl).origin
  return [
    "default-src 'self'",
    "script-src 'self'",
    // React and Leaflet set inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://server.arcgisonline.com",
    "font-src 'self' data:",
    `connect-src 'self' ${api}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

// Adds the CSP as a <meta> tag to the production build only (the dev server
// relies on inline scripts for hot reload).
function cspMeta(csp) {
  // frame-ancestors is ignored in <meta>; it is sent as a header instead.
  const metaCsp = csp.split('; ').filter((rule) => !rule.startsWith('frame-ancestors')).join('; ')
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: metaCsp }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'strict-origin-when-cross-origin' }, injectTo: 'head' },
    ],
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const csp = contentSecurityPolicy(
    env.VITE_API_URL || 'https://smartag-ops-backend.onrender.com',
  )
  return {
    plugins: [react(), cspMeta(csp)],
    server: { port: 5173, headers: SECURITY_HEADERS },
    preview: { headers: { ...SECURITY_HEADERS, 'Content-Security-Policy': csp } },
  }
})
