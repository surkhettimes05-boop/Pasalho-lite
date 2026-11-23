import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const localEdge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browserPath = process.env.PASALHO_E2E_BROWSER_PATH ?? (existsSync(localEdge) ? localEdge : undefined);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3111",
    browserName: "chromium",
    launchOptions: { executablePath: browserPath },
  },
  webServer: {
    command: "node scripts/serve-offline-shell.mjs",
    url: "http://127.0.0.1:3111/offline-pos.html",
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
