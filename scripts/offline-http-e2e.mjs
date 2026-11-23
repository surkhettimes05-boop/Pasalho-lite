import { createHmac, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.test", override: true, quiet: true });
const source = new URL(process.env.DATABASE_URL || "");
if (process.env.APP_ENV !== "test" || !["localhost", "127.0.0.1"].includes(source.hostname)) throw new Error("HTTP E2E requires local .env.test PostgreSQL.");
const appPort = 3112;
const pricingPort = 3113;
const base = `http://127.0.0.1:${appPort}`;
const sku = `HTTP-OFF-${randomBytes(4).toString("hex")}`;
const productId = randomUUID();
const terminalId = randomUUID();
const transactionId = randomUUID();
let client;
let admin;
let temporaryDatabase;
let app;
let pricing;
let sessionId;

async function request(path, token, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { cookie: `pasalho_session=${token}`, origin: base, "content-type": "application/json", ...options.headers } });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(`${path}: HTTP ${response.status} ${body.code || "invalid response"}`);
  return body;
}

async function waitForApp() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (app.exitCode !== null) throw new Error(`Next app exited with ${app.exitCode}.`);
    try { const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok) return; } catch { /* starting */ }
    await delay(1000);
  }
  throw new Error("Next app did not become healthy within 60 seconds.");
}

try {
  const adminUrl = new URL(source);
  adminUrl.pathname = "/postgres";
  admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  temporaryDatabase = `pasalho_http_e2e_${randomBytes(5).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${temporaryDatabase}"`);
  const target = new URL(source);
  target.pathname = `/${temporaryDatabase}`;
  process.env.DATABASE_URL = target.toString();
  for (const args of [["migrate", "deploy"], ["db", "seed"]]) {
    const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", ...args], { stdio: "inherit", env: process.env });
    if (result.status !== 0) throw new Error(`Prisma ${args.join(" ")} failed with ${result.status}.`);
  }
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const owner = (await client.query('SELECT "id", "name", "email" FROM "User" WHERE "email" = $1 AND "role" = $2 AND "active" = true', [process.env.SEED_OWNER_EMAIL.toLowerCase(), "OWNER_ADMIN"])).rows[0];
  const store = (await client.query('SELECT "id" FROM "Location" WHERE "code" = $1', ["STORE_MAIN"])).rows[0];
  if (!owner || !store) throw new Error("Seed owner/store not present in local test DB.");
  await client.query('INSERT INTO "Product" ("id", "sku", "name", "category", "unit", "costPrice", "sellingPrice", "active", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,true,now(),now())', [productId, sku, "Offline HTTP E2E Item", "Test", "pcs", "40.00", "100.00"]);
  await client.query('INSERT INTO "StockBalance" ("id", "productId", "locationId", "onHand", "reserved", "updatedAt") VALUES ($1,$2,$3,10,0,now())', [randomUUID(), productId, store.id]);
  await client.query('INSERT INTO "InventoryMovement" ("id", "productId", "locationId", "type", "quantityDelta", "referenceType", "referenceId", "idempotencyKey", "actorUserId", "createdAt") VALUES ($1,$2,$3,$4,10,$5,$6,$7,$8,now())', [randomUUID(), productId, store.id, "PURCHASE_RECEIPT", "HTTP_E2E_SETUP", productId, `http-e2e-stock:${productId}`, owner.id]);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHmac("sha256", process.env.AUTH_SECRET).update(token).digest("hex");
  sessionId = randomUUID();
  await client.query('INSERT INTO "Session" ("id", "tokenHash", "userId", "expiresAt", "createdAt") VALUES ($1,$2,$3,now() + interval \'1 hour\',now())', [sessionId, tokenHash, owner.id]);

  pricing = createServer((req, res) => {
    if (!req.url?.startsWith("/api/internal/member-pricing/catalog") || req.headers.authorization !== `Bearer ${process.env.MODERN_PRICING_SERVICE_TOKEN}`) { res.writeHead(404); res.end(); return; }
    const storeReference = new URL(req.url, `http://127.0.0.1:${pricingPort}`).searchParams.get("storeReference");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ storeReference, currency: "NPR", products: [{ productReference: randomUUID(), sku, active: true, regularUnitPrice: "100.00", currency: "NPR", memberPricingEligible: true, ineligibilityReasons: [] }] }));
  });
  await new Promise((resolve) => pricing.listen(pricingPort, "127.0.0.1", resolve));
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(appPort)], { env: { ...process.env, MODERN_PRICING_API_URL: `http://127.0.0.1:${pricingPort}`, APP_URL: base }, stdio: ["ignore", "pipe", "pipe"] });
  let appLog = "";
  app.stdout.on("data", (chunk) => { appLog = (appLog + chunk.toString()).slice(-4000); });
  app.stderr.on("data", (chunk) => { appLog = (appLog + chunk.toString()).slice(-4000); });
  await waitForApp();

  const candidates = await request("/api/offline/provision", token);
  if (candidates.products.find((item) => item.productId === productId)?.priceCents !== 10000) throw new Error("Approved Modern catalog price missing.");
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = pair.publicKey.export({ format: "jwk" });
  const provisioned = await request("/api/offline/provision", token, { method: "POST", body: JSON.stringify({ terminalId, cashierEmail: owner.email, publicKey: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, productIds: [productId], approvedPrices: [{ productId, priceCents: 10000 }], taxInclusiveApproved: true }) });
  if (provisioned.snapshot.products[0].priceCents !== 10000) throw new Error("Snapshot price mismatch.");
  await new Promise((resolve) => pricing.close(resolve)); pricing = undefined;

  const payload = JSON.stringify({ version: 1, transactionId, snapshotId: provisioned.snapshot.id, terminalId, storeId: store.id, cashierId: owner.id, createdAt: new Date().toISOString(), receiptNumber: `OFF-${transactionId.toUpperCase()}`, items: [{ productId, quantity: 1, priceCents: 10000, lineTotalCents: 10000 }], subtotalCents: 10000, discountCents: 0, taxPolicy: "REGULAR_PRICE_TAX_INCLUSIVE", payment: { method: "CASH", tenderedCents: 10000 } });
  const signature = sign("sha256", Buffer.from(payload), { key: pair.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
  const first = await request("/api/offline/sync", token, { method: "POST", body: JSON.stringify({ payload, signature }) });
  const replay = await request("/api/offline/sync", token, { method: "POST", body: JSON.stringify({ payload, signature }) });
  if (first.status !== "SYNCED" || first.saleId !== transactionId || replay.saleId !== transactionId) throw new Error("Sync acknowledgment mismatch.");
  const counts = await client.query('SELECT (SELECT count(*) FROM "Sale" WHERE "id"=$1) AS sale, (SELECT count(*) FROM "Payment" WHERE "sourceId"=$1) AS payment, (SELECT count(*) FROM "InventoryMovement" WHERE "referenceType"=$2 AND "referenceId"=$1) AS movement', [transactionId, "SALE"]);
  if (Number(counts.rows[0].sale) !== 1 || Number(counts.rows[0].payment) !== 1 || Number(counts.rows[0].movement) !== 1) throw new Error("Duplicate or missing business effect.");
  console.log("HTTP E2E PASS: authenticated provision + sync + replay with pricing service offline; one sale, payment, movement.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  throw error;
} finally {
  if (app) { app.kill(); await Promise.race([new Promise((resolve) => app.once("exit", resolve)), delay(5000)]); }
  if (pricing) await new Promise((resolve) => pricing.close(resolve));
  if (sessionId && client) await client.query('DELETE FROM "Session" WHERE "id"=$1', [sessionId]);
  if (client) await client.end();
  if (admin) {
    if (temporaryDatabase) await admin.query(`DROP DATABASE IF EXISTS "${temporaryDatabase}" WITH (FORCE)`);
    await admin.end();
  }
}
