import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  // Retry in CI so a rare touch-input flake self-heals; the retry also triggers the
  // `trace: on-first-retry` capture below, so a genuinely reproducible failure still yields a
  // trace artifact to diagnose (uploaded by the workflow on failure). No retries locally.
  retries: process.env.CI ? 2 : 0,
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
