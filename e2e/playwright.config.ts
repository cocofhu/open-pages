import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  // CI shards the theme suite by individual test. Each shard still has one
  // worker, so generations remain serial inside its isolated runner.
  fullyParallel: true,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    locale: "zh-CN",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @open-pages/api dev",
      url: "http://localhost:8787/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      cwd: "..",
      env: {
        ...process.env,
        PORT: "8787",
        PREVIEW_PORT: "8788",
        PREVIEW_ORIGIN: "http://localhost:8788",
        APP_ORIGIN: "http://localhost:5173",
        API_ORIGIN: "http://localhost:8787",
      },
    },
    {
      command: "pnpm --filter @open-pages/web dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      cwd: "..",
    },
  ],
});
