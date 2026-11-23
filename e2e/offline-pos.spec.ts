import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";

const localEdge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const edge = process.env.PASALHO_E2E_BROWSER_PATH ?? (existsSync(localEdge) ? localEdge : undefined);
const productId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const cashierId = "33333333-3333-4333-8333-333333333333";

async function prepare(context: BrowserContext) {
  await context.addInitScript(() => {
    // The browser storage itself remains real; only the persistence permission
    // is granted by the test harness because fresh headless profiles lack site engagement.
    Object.defineProperty(navigator.storage, "persisted", { configurable: true, value: async () => true });
    Object.defineProperty(navigator.storage, "persist", { configurable: true, value: async () => true });
    (window as typeof window & { __prints: number }).__prints = 0;
    window.print = () => { (window as typeof window & { __prints: number }).__prints += 1; };
  });
}

test("offline shell saves consecutive cash sales across refresh and browser restart", async () => {
  const profile = await mkdtemp(join(tmpdir(), "pasalho-offline-e2e-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, { executablePath: edge, headless: true, baseURL: "http://127.0.0.1:3111" });
    await prepare(context);
    const page = context.pages()[0] ?? await context.newPage();
    await page.route("**/api/offline/provision", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { ok: true, cashiers: [{ email: "cashier@example.test", name: "Cashier" }], products: [{ productId, sku: "TEST-OFF", barcode: "987654321", name: "Test Item", unit: "pcs", priceCents: 10000, availableUnits: 10 }] } });
        return;
      }
      const request = route.request().postDataJSON();
      const now = new Date();
      await route.fulfill({ json: { ok: true, snapshot: { version: 1, id: crypto.randomUUID(), terminalId: request.terminalId, storeId, storeName: "Test Store", cashierId, cashierName: "Cashier", issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 8 * 60 * 60_000).toISOString(), maxTotalCents: 5_000_000, taxPolicy: "REGULAR_PRICE_TAX_INCLUSIVE", products: [{ productId, sku: "TEST-OFF", barcode: "987654321", name: "Test Item", unit: "pcs", priceCents: 10000, availableUnits: 10 }] } } });
    });
    await page.goto("/offline-pos.html");
    await expect(page.getByRole("heading", { name: "Owner provisioning" })).toBeVisible();
    await page.locator("#new-passphrase").fill("offline-test-passphrase");
    await page.getByRole("button", { name: "Approve and initialize terminal" }).click();
    await expect(page.getByRole("heading", { name: "Current cash sale" })).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);

    async function sell() {
      await page.locator("#search").fill("987654321");
      await page.locator("#search").press("Enter");
      await page.locator("#tendered").fill("100.00");
      await page.getByRole("button", { name: "Save cash sale locally" }).click();
      await expect(page.locator("#cart")).toBeEmpty();
    }
    await context.setOffline(true);
    await sell();
    await expect(page.locator("#history .row")).toHaveCount(1);
    await page.reload();
    await page.locator("#passphrase").fill("offline-test-passphrase");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.locator("#history .row")).toHaveCount(1);
    await sell();
    await expect(page.locator("#history .row")).toHaveCount(2);
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("pasalho-offline-pos", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const records = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const request = database.transaction("sales", "readonly").objectStore("sales").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("sales", "readwrite");
        transaction.objectStore("sales").put({ ...records[0], state: "SYNCING" });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    });
    await context.close(); context = undefined;

    context = await chromium.launchPersistentContext(profile, { executablePath: edge, headless: true, baseURL: "http://127.0.0.1:3111" });
    await prepare(context);
    await context.setOffline(true);
    const restarted = context.pages()[0] ?? await context.newPage();
    await restarted.goto("/offline-pos.html");
    await restarted.locator("#passphrase").fill("offline-test-passphrase");
    await restarted.getByRole("button", { name: "Unlock" }).click();
    await expect(restarted.locator("#history .row")).toHaveCount(2);
    await expect(restarted.locator("#history")).toContainText("SYNCING");
    await restarted.getByRole("button", { name: "View / print" }).first().click();
    expect(await restarted.evaluate(() => (window as typeof window & { __prints: number }).__prints)).toBe(1);
    await expect(restarted.locator("#history .row")).toHaveCount(2);

    let syncCalls = 0;
    await context.route("**/api/ready", (route) => route.fulfill({ status: 200, json: { status: "ready" } }));
    await context.route("**/api/offline/sync", async (route) => {
      syncCalls += 1;
      if (syncCalls === 1) { await route.fulfill({ status: 503, json: { ok: false, code: "DATABASE_UNAVAILABLE" } }); return; }
      const sale = JSON.parse(route.request().postDataJSON().payload);
      await route.fulfill({ json: { ok: true, status: "SYNCED", reason: null, transactionId: sale.transactionId, saleId: sale.transactionId } });
    });
    await context.setOffline(false);
    await expect(restarted.locator("#sync-error")).toContainText("DATABASE_UNAVAILABLE");
    await expect(restarted.locator("#pending")).toContainText("2 pending");
    await restarted.getByRole("button", { name: "Retry sync" }).click();
    await expect(restarted.locator("#pending")).toContainText("0 pending");
    await expect(restarted.locator("#history")).toContainText("SYNCED");
    expect(syncCalls).toBe(3);

    await context.unroute("**/api/offline/sync");
    await context.route("**/api/offline/sync", async (route) => {
      const sale = JSON.parse(route.request().postDataJSON().payload);
      await route.fulfill({ json: { ok: true, status: "CONFLICT", reason: "INSUFFICIENT_STOCK", transactionId: sale.transactionId, saleId: null } });
    });
    await restarted.locator("#search").fill("TEST-OFF");
    await restarted.locator("#search").press("Enter");
    await restarted.locator("#tendered").fill("100.00");
    await restarted.getByRole("button", { name: "Save cash sale locally" }).click();
    await expect(restarted.locator("#connection")).toHaveText("ATTENTION REQUIRED");
    await expect(restarted.locator("#history .row")).toHaveCount(3);

    await restarted.evaluate(() => {
      Object.defineProperty(navigator.storage, "persisted", { configurable: true, value: async () => false });
      Object.defineProperty(navigator.storage, "persist", { configurable: true, value: async () => false });
    });
    await restarted.locator("#search").fill("TEST-OFF");
    await restarted.locator("#search").press("Enter");
    await restarted.locator("#tendered").fill("100.00");
    await restarted.getByRole("button", { name: "Save cash sale locally" }).click();
    await expect(restarted.locator("#sale-error")).toContainText("Persistent device storage was denied");
    await expect(restarted.locator("#history .row")).toHaveCount(3);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("two tabs on one terminal cannot sell the same last local unit", async () => {
  const profile = await mkdtemp(join(tmpdir(), "pasalho-offline-tabs-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, { executablePath: edge, headless: true, baseURL: "http://127.0.0.1:3111" });
    await prepare(context);
    const first = context.pages()[0] ?? await context.newPage();
    await context.route("**/api/offline/provision", async (route) => {
      const product = { productId, sku: "LAST-UNIT", barcode: "123456789", name: "Last Unit", unit: "pcs", priceCents: 10000, availableUnits: 1 };
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { ok: true, cashiers: [{ email: "cashier@example.test", name: "Cashier" }], products: [product] } });
        return;
      }
      const request = route.request().postDataJSON();
      const now = new Date();
      await route.fulfill({ json: { ok: true, snapshot: { version: 1, id: crypto.randomUUID(), terminalId: request.terminalId, storeId, storeName: "Test Store", cashierId, cashierName: "Cashier", issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 8 * 60 * 60_000).toISOString(), maxTotalCents: 5_000_000, taxPolicy: "REGULAR_PRICE_TAX_INCLUSIVE", products: [product] } } });
    });
    await first.goto("/offline-pos.html");
    await first.locator("#new-passphrase").fill("offline-test-passphrase");
    await first.getByRole("button", { name: "Approve and initialize terminal" }).click();
    await expect(first.locator("#catalog")).toContainText("Last Unit");
    const second = await context.newPage();
    await second.goto("/offline-pos.html");
    await second.locator("#passphrase").fill("offline-test-passphrase");
    await second.getByRole("button", { name: "Unlock" }).click();
    await context.setOffline(true);
    for (const page of [first, second]) {
      await page.locator("#search").fill("LAST-UNIT");
      await page.locator("#search").press("Enter");
      await page.locator("#tendered").fill("100.00");
    }
    await Promise.all([
      first.getByRole("button", { name: "Save cash sale locally" }).click(),
      second.getByRole("button", { name: "Save cash sale locally" }).click(),
    ]);
    await expect.poll(async () => [await first.locator("#sale-error").textContent(), await second.locator("#sale-error").textContent()].filter(Boolean).length).toBe(1);
    const errors = [await first.locator("#sale-error").textContent(), await second.locator("#sale-error").textContent()].filter(Boolean);
    expect(errors[0]).toContain("Local stock is insufficient");
    await first.reload();
    await first.locator("#passphrase").fill("offline-test-passphrase");
    await first.getByRole("button", { name: "Unlock" }).click();
    await expect(first.locator("#history .row")).toHaveCount(1);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
