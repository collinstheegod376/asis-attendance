import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const supabaseUrl = env.VITE_SUPABASE_URL || 'https://ijfljngylbzwyyikivob.supabase.co';

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: [
          'apple-touch-icon.png',
          'adun-shield.svg',
          'adun-logo.png',
          'favicon.svg',
          'icons.svg',
          'pwa-192x192.png',
          'pwa-512x512.png',
        ],
        manifest: {
          name: 'ADUN Attendance',
          short_name: 'ADUN Attendance',
          description: 'Admiralty University of Nigeria - Mobile Attendance Verification System',
          theme_color: '#1E40AF',
          background_color: '#FFFFFF',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
          maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api/],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/api'),
              handler: 'NetworkOnly',
            },
            {
              urlPattern: ({ url }) => url.pathname.endsWith('.wasm') || url.pathname.endsWith('.task'),
              handler: 'CacheFirst',
            },
          ],
        },
      }),
    ],
    server: {
      proxy: {
        '/api': {
          target: `${supabaseUrl}/functions/v1`,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 1500,
    },
  };
});
