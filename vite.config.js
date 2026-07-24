import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

// Прокси к Open Food Facts: у search-a-licious сломан CORS (нет Access-Control-Allow-Origin),
// а legacy-поиск режется анти-бот-защитой, поэтому локально ходим через сервер Vite.
const offProxy = {
  // Наш бэкенд (Express + Postgres)
  '/api': {
    target: 'http://localhost:7347',
    changeOrigin: true,
  },
  '/off-search': {
    target: 'https://search.openfoodfacts.org',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/off-search/, ''),
  },
  '/off-ru': {
    target: 'https://ru.openfoodfacts.org',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/off-ru/, ''),
  },
  '/off-world': {
    target: 'https://world.openfoodfacts.org',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/off-world/, ''),
  },
};

export default defineConfig({
  // Непопулярные порты, чтобы не конфликтовать с 3000/5173/8080 и т. п.
  server: {
    port: 7345,
    proxy: offProxy,
  },
  preview: {
    port: 7346,
    proxy: offProxy,
  },
  plugins: [
    react(),
    tailwindcss(),
    process.env.HTTPS === '1' ? basicSsl() : null,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
      manifest: {
        id: '/',
        name: 'Трекер калорий',
        short_name: 'Калории',
        description: 'Личный дневник питания: калории и БЖУ',
        lang: 'ru',
        start_url: '/',
        display: 'standalone',
        background_color: '#f5f5f4',
        theme_color: '#059669',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
