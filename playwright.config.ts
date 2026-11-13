import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3300;
// Браузер: E2E_BROWSER_PATH, иначе установленный Edge/Chrome (чтобы не скачивать бинарники), иначе Chromium от Playwright
// (`npx playwright install chromium`).
const candidates = [
  process.env.E2E_BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const executablePath = candidates.find((c) => c && fs.existsSync(c));
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
  // Сценарии меняют общие данные (остатки, заказы), поэтому идут последовательно.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  globalSetup: "./e2e/support/global-setup.ts",
  globalTeardown: "./e2e/support/global-teardown.ts",
  use: { baseURL: `http://localhost:${PORT}`, launchOptions, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "ru-RU" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions, viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { ...devices["iPad (gen 7)"], browserName: "chromium", launchOptions }, testMatch: /responsive/ },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions }, testMatch: /responsive/ },
  ],
  // Production-сборка: тестируем то, что уйдёт в прод. Сначала `npm run build`.
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
  },
});
