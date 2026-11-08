import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'adun-shield.svg', 'adun-logo.png'],
      manifest: {
        name: 'ADUN Attendance',
        short_name: 'ADUN Attend',
        description: 'Admiralty University of Nigeria - Mobile Attendance Verification System',
        theme_color: '#1E40AF',
        background_color: '#FFFFFF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: '/adun-logo.png',
            sizes: '192x192 512x512',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/join/, /^\/attend/, /^\/api/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/join') || url.pathname.startsWith('/attend') || url.pathname.startsWith('/api') || url.hostname.includes('supabase'),
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ],
  build: {
    chunkSizeWarningLimit: 1200,
  }
})
