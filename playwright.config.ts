import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:18081",
    trace: "on-first-retry"
  },
  webServer: {
    command: "corepack pnpm dev",
    url: "http://127.0.0.1:18081",
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: "test",
      API_PORT: "3000",
      WEB_PORT: "18081",
      WEB_ORIGIN: "http://127.0.0.1:18081",
      SQLITE_PATH: ".data/playwright.sqlite",
      SESSION_SECRET: "playwright-secret"
    }
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
