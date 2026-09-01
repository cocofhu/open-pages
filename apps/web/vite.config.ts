import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Open Pages",
        short_name: "Open Pages",
        description: "Typora-like Markdown editor with Hexo and GitHub Pages",
        theme_color: "#2c2a26",
        background_color: "#f7f4ef",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [
          /^\/auth(?:\/|$)/,
          /^\/addons(?:\/|$)/,
          /^\/sites(?:\/|$)/,
          /^\/health(?:\/|$)/,
          // Previews moved to their own origin. A leftover tab or bookmark on
          // the old same-origin path should get a plain 404 rather than the app
          // shell rendered into a frame-shaped blank page.
          /^\/preview(?:\/|$)/,
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/auth": { target: "http://localhost:8787", changeOrigin: true },
      "/addons": { target: "http://localhost:8787", changeOrigin: true },
      "/sites": { target: "http://localhost:8787", changeOrigin: true },
      "/health": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
