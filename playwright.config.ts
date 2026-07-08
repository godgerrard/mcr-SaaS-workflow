import { defineConfig } from "@playwright/test";

// Playwright's node process doesn't auto-load .env.local; in CI the file is
// absent and the vars come from job-level env.
try {
  process.loadEnvFile(".env.local");
} catch {}

export default defineConfig({
  testDir: "tests",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 1,
  reporter: "list",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start",
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
