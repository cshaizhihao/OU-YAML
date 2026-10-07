import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8000 },
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:18787", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
    { name: "tablet", use: { browserName: "chromium", viewport: { width: 768, height: 1024 } } },
    { name: "mobile", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "node dist-server/index.js",
    url: "http://127.0.0.1:18787/api/auth/me",
    reuseExistingServer: false,
    env: { NODE_ENV: "production", PORT: "18787", DATA_DIR: mkdtempSync(path.join(os.tmpdir(), "ou-e2e-")), ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "ou-yaml-e2e-12345", LOGIN_RATE_LIMIT: "100", COOKIE_SECURE: "false", APP_ORIGIN: "http://127.0.0.1:18787" },
  },
});
