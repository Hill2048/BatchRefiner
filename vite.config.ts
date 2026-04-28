import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['flora.svg'],
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
        },
        manifest: {
          name: 'BatchRefiner',
          short_name: 'BatchRefiner',
          description: 'AI 批量图片生成与编辑工作台',
          theme_color: '#f9f8f6',
          background_color: '#f9f8f6',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/flora.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;

            if (id.includes('jszip')) {
              return 'zip-vendor';
            }

            if (id.includes('papaparse')) {
              return 'csv-vendor';
            }

            if (id.includes('file-saver')) {
              return 'file-vendor';
            }

            if (id.includes('idb-keyval') || id.includes('zustand') || id.includes('uuid')) {
              return 'state-vendor';
            }

            if (
              id.includes('react') ||
              id.includes('scheduler') ||
              id.includes('@dnd-kit') ||
              id.includes('@base-ui') ||
              id.includes('lucide-react') ||
              id.includes('sonner') ||
              id.includes('next-themes') ||
              id.includes('class-variance-authority') ||
              id.includes('clsx') ||
              id.includes('tailwind-merge') ||
              id.includes('tw-animate-css')
            ) {
              return 'app-vendor';
            }
          },
        },
      },
    },
    server: {
      // When DISABLE_HMR=true, keep HMR off to avoid UI flicker during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: [
          '**/*.log',
          '**/docs/**',
          '**/dist/**',
          '**/dev-dist/**',
          '**/output/**',
          '**/*.md',
        ],
      },
    },
  };
});
