import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";

const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://proxy:proxy@localhost:5432/proxy_e2e";
const PORT = 3100;
export const e2eEnv = {
  DATABASE_URL: E2E_DB,
  AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-12",
  APP_BASE_URL: `http://127.0.0.1:${PORT}`,
  // Third-party services are replaced by local contract-compatible stand-ins (tests/fixtures/stubs.ts).
  SERPAPI_API_KEY: "test-serp-key", SERPAPI_BASE_URL: "http://127.0.0.1:4101", SERPAPI_CACHE_TTL_HOURS: "0",
  RESEND_API_KEY: "re_test_key", RESEND_FROM_EMAIL: "Procurement <rfq@proxy-e2e.example>", RESEND_BASE_URL: "http://127.0.0.1:4102",
  FETCH_ALLOW_PRIVATE_FOR_TESTS: "1", FETCH_TEST_HOST_MAP: "acme-steel.test=127.0.0.1,beta-pipes.test=127.0.0.1,gamma-metals.test=127.0.0.1",
  NEXT_TELEMETRY_DISABLED: "1",
};

// Fresh database for every E2E run (config is evaluated before web servers start).
if (process.env.TEST_WORKER_INDEX === undefined) execSync("npx tsx tests/e2e/prepare-db.ts", { env: { ...process.env, ...e2eEnv }, stdio: "inherit" });

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off", ...devices["Desktop Chrome"], launchOptions: { args: ["--no-sandbox"], ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}) } },
  webServer: [
    { command: "npx tsx tests/fixtures/run-stubs.ts", port: 4101, reuseExistingServer: true, timeout: 30_000 },
    { command: `npx next dev -p ${PORT}`, port: PORT, reuseExistingServer: true, timeout: 120_000, env: e2eEnv },
    { command: "npx tsx worker/index.ts", reuseExistingServer: true, timeout: 60_000, env: e2eEnv, wait: { stdout: /ready — queues/ } },
  ],
});
