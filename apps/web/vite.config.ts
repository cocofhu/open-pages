import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// The desktop shell serves this bundle from http://tauri.localhost on Windows,
// which is a secure origin, so the PWA service worker registers and precaches
// the app shell. Reinstalling replaces the executable but not that cache: the
// old worker keeps answering navigations with the old index.html and its old
// hashed assets, and the new version never shows up. macOS and Linux load the
// same bundle over the tauri:// scheme, where no worker can register, which is
// why only Windows sees it. A self-destroying worker unregisters itself and
// drops its caches, so installs that already have one recover on next launch.
const desktopShell = process.env.OPEN_PAGES_DESKTOP === "1";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      selfDestroying: desktopShell,
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
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
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
