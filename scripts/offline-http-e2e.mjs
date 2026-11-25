import { createHmac, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopLedger } from "../desktop/ledger.mjs";
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
let desktopLedger;
let desktopDir;

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
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(appPort)], { env: { ...process.env, MODERN_PRICING_API_URL: `http://127.0.0.1:${pricingPort}`, MODERN_PRICING_STORE_REFERENCE: "00000000-0000-4000-8000-000000000001", APP_URL: base }, stdio: ["ignore", "pipe", "pipe"] });
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

  desktopDir = mkdtempSync(join(tmpdir(), "pasalho-http-desktop-"));
  const ledgerPath = join(desktopDir, "ledger.sqlite");
  desktopLedger = new DesktopLedger(ledgerPath);
  desktopLedger.provision(provisioned.snapshot, pair.privateKey.export({type:"pkcs8",format:"pem"}), "isolated test passphrase");
  desktopLedger.finalize({transactionId,items:[{productId,quantity:1}],tenderedCents:10000});
  desktopLedger.close();
  desktopLedger = new DesktopLedger(ledgerPath);
  desktopLedger.unlock("isolated test passphrase");
  const pending = desktopLedger.pending();
  if (pending.length !== 1) throw new Error("Desktop receipt recovery failed.");
  const {payload,signature} = pending[0];
  const first = await request("/api/offline/sync", token, { method: "POST", body: JSON.stringify({ payload, signature }) });
  const replay = await request("/api/offline/sync", token, { method: "POST", body: JSON.stringify({ payload, signature }) });
  if (first.status !== "SYNCED" || first.saleId !== transactionId || replay.saleId !== transactionId) throw new Error("Sync acknowledgment mismatch.");
  desktopLedger.acknowledge(transactionId, replay);
  if (desktopLedger.pending().length !== 0 || desktopLedger.history()[0].state !== "SYNCED") throw new Error("Desktop reconciliation failed.");
  const counts = await client.query('SELECT (SELECT count(*) FROM "Sale" WHERE "id"=$1) AS sale, (SELECT count(*) FROM "Payment" WHERE "sourceId"=$1) AS payment, (SELECT count(*) FROM "InventoryMovement" WHERE "referenceType"=$2 AND "referenceId"=$1) AS movement', [transactionId, "SALE"]);
  if (Number(counts.rows[0].sale) !== 1 || Number(counts.rows[0].payment) !== 1 || Number(counts.rows[0].movement) !== 1) throw new Error("Duplicate or missing business effect.");
  await request("/api/offline/provision", token, { method: "DELETE", body: JSON.stringify({ terminalId }) });
  async function submitRevokedReceipt() {
    const id = randomUUID();
    const receipt = JSON.stringify({ ...JSON.parse(payload), transactionId: id, receiptNumber: `OFF-${id.toUpperCase()}`, createdAt: new Date().toISOString() });
    const signed = sign("sha256", Buffer.from(receipt), { key: pair.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
    const result = await request("/api/offline/sync", token, { method: "POST", body: JSON.stringify({ payload: receipt, signature: signed }) });
    if (result.status !== "REQUIRES_REVIEW") throw new Error("Revoked device receipt should require owner review.");
    const reviews = await request("/api/offline/reviews", token);
    const review = reviews.reviews.find((item) => item.transactionId === id);
    if (!review || review.sale.subtotalCents !== 10000) throw new Error("Owner review is missing original receipt evidence.");
    return { id, receipt, signed, review };
  }
  const postCase = await submitRevokedReceipt();
  const postInput = { transactionId: postCase.id, payloadHash: postCase.review.payloadHash, cashAmountCents: 10000, action: "POST_SALE", evidence: "Owner counted cash and stock; signed receipt accepted." };
  const posted = await request("/api/offline/reviews", token, { method: "POST", body: JSON.stringify(postInput) });
  const postedReplay = await request("/api/offline/reviews", token, { method: "POST", body: JSON.stringify(postInput) });
  const syncedReplay = await request("/api/offline/sync", token, { method: "POST", body: JSON.stringify({ payload: postCase.receipt, signature: postCase.signed }) });
  if (posted.saleId !== postCase.id || postedReplay.saleId !== postCase.id || syncedReplay.status !== "SYNCED") throw new Error("Owner post/replay acknowledgment mismatch.");
  const refundCase = await submitRevokedReceipt();
  const refundInput = { transactionId: refundCase.id, payloadHash: refundCase.review.payloadHash, cashAmountCents: 10000, action: "CASH_REFUNDED", evidence: "Cash was returned in full; witness recorded REF-HTTP-001." };
  await request("/api/offline/reviews", token, { method: "POST", body: JSON.stringify(refundInput) });
  const refundedReplay = await request("/api/offline/sync", token, { method: "POST", body: JSON.stringify({ payload: refundCase.receipt, signature: refundCase.signed }) });
  const settlementCounts = await client.query('SELECT (SELECT count(*) FROM "Sale" WHERE "id"=$1) AS posted_sale, (SELECT count(*) FROM "Payment" WHERE "sourceId"=$1) AS posted_payment, (SELECT count(*) FROM "InventoryMovement" WHERE "referenceType"=$3 AND "referenceId"=$1) AS posted_movement, (SELECT count(*) FROM "Sale" WHERE "id"=$2) AS refunded_sale, (SELECT count(*) FROM "CashMovement" WHERE "referenceType"=$4 AND "referenceId"=$2) AS refund_cash', [postCase.id, refundCase.id, "SALE", "OFFLINE_SUBMISSION"]);
  const s = settlementCounts.rows[0];
  if (Number(s.posted_sale) !== 1 || Number(s.posted_payment) !== 1 || Number(s.posted_movement) !== 1 || Number(s.refunded_sale) !== 0 || Number(s.refund_cash) !== 2 || refundedReplay.status !== "REFUNDED") throw new Error("Owner resolution duplicated or lost financial effects.");
  console.log("HTTP E2E PASS: authenticated sync/replay and owner post/refund resolution with pricing service offline.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  throw error;
} finally {
  if (desktopLedger) desktopLedger.close();
  if (desktopDir) rmSync(desktopDir,{recursive:true,force:true});
  if (app) { app.kill(); await Promise.race([new Promise((resolve) => app.once("exit", resolve)), delay(5000)]); }
  if (pricing) await new Promise((resolve) => pricing.close(resolve));
  if (sessionId && client) await client.query('DELETE FROM "Session" WHERE "id"=$1', [sessionId]);
  if (client) await client.end();
  if (admin) {
    if (temporaryDatabase) await admin.query(`DROP DATABASE IF EXISTS "${temporaryDatabase}" WITH (FORCE)`);
    await admin.end();
  }
}
