import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { _electron as electron } from '@playwright/test';
import { DesktopLedger, generateTerminalKey } from './ledger.mjs';

test('installed shell finalizes keyboard-wedge cash sale and recovers it after restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pasalho-electron-'));
  const productId = randomUUID();
  const snapshot = {
    version: 1, id: randomUUID(), terminalId: randomUUID(), storeId: randomUUID(), cashierId: randomUUID(),
    storeName: 'Test Store', cashierName: 'Test Cashier', issuedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    maxTotalCents: 5_000_000, taxPolicy: 'REGULAR_PRICE_TAX_INCLUSIVE',
    products: [{ productId, sku: 'RICE-1', barcode: '123456789', name: 'Rice', unit: 'each', priceCents: 12500, availableUnits: 2 }],
  };
  const ledger = new DesktopLedger(join(dir, 'cash-ledger.sqlite'));
  const key = generateTerminalKey();
  ledger.provision(snapshot, key.privateKeyPem, 'terminal passphrase 123');
  ledger.close();
  let synced = 0;
  let attempts = 0;
  const committed = new Map();
  const server = createServer(async (request, response) => {
    if (request.url === '/login') {
      response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'pasalho_session=test; HttpOnly; SameSite=Lax; Path=/' });
      response.end('<!doctype html><title>Signed in</title><p>Signed in</p>');
      return;
    }
    if (request.url === '/api/offline/sync' && request.method === 'POST') {
      assert.equal(request.headers.origin, `http://127.0.0.1:${server.address().port}`);
      assert.match(request.headers.cookie || '', /pasalho_session=test/);
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw), payload = JSON.parse(body.payload);
      assert.equal(verify('sha256', Buffer.from(body.payload), { key: createPublicKey({ key: key.publicKeyJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(body.signature, 'base64')), true);
      attempts++;
      const previous = committed.get(payload.transactionId);
      if (previous) assert.deepEqual(body, previous);
      else { committed.set(payload.transactionId, body); synced++; }
      // Simulate a committed server sale whose acknowledgment is lost.
      if (attempts === 1) { response.writeHead(503, { 'content-type': 'application/json' }); response.end(JSON.stringify({ok:false,code:'ACK_UNAVAILABLE'})); return; }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, transactionId: payload.transactionId, status: 'SYNCED', saleId: payload.transactionId }));
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ backendUrl: `http://127.0.0.1:${server.address().port}` }));
  const executablePath = createRequire(import.meta.url)('electron');
  assert.ok(existsSync(executablePath), `Electron executable missing: ${executablePath}`);
  const launch = () => electron.launch({ executablePath, cwd: import.meta.dirname, args: [import.meta.dirname], env: { ...process.env, NODE_ENV: 'test', PASALHO_DESKTOP_TEST_DIR: dir, PASALHO_DESKTOP_TEST_PRINT_FAIL: '1' } });
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.locator('#passphrase').fill('terminal passphrase 123');
    await page.locator('#unlock-button').click();
    await page.locator('#search').fill('123456789');
    await page.locator('#search').press('Enter');
    await page.locator('#tendered').fill('125.00');
    await page.locator('#finalize').click();
    await page.getByText(/Sale saved locally; printer failed/).waitFor();
    assert.match(await page.locator('#history').innerText(), /PENDING_SYNC/);
    await app.close(); app = null;
    app = await launch();
    page = await app.firstWindow();
    await page.locator('#passphrase').fill('terminal passphrase 123');
    await page.locator('#unlock-button').click();
    assert.match(await page.locator('#history').innerText(), /OFF-/);
    const recovered = await page.evaluate(() => window.pasalho.status());
    assert.equal(recovered.counts.find((row) => row.state === 'PENDING_SYNC')?.count, 1);
    const loginWindow = app.waitForEvent('window');
    await page.locator('#login-again').click();
    const login = await loginWindow; await login.waitForLoadState();
    await page.locator('#sync').click();
    await page.locator('#message').filter({hasText:'ACK_UNAVAILABLE'}).waitFor();
    assert.equal(attempts, 1);
    assert.equal(committed.size, 1);
    assert.match(await page.locator('#history').innerText(), /PENDING_SYNC/);
    await page.locator('#sync').click();
    await page.getByText(/1 receipt\(s\) reconciled/).waitFor();
    assert.match(await page.locator('#history').innerText(), /SYNCED/);
    await page.locator('#sync').click();
    await page.getByText(/0 receipt\(s\) reconciled/).waitFor();
    assert.equal(synced, 1);
    assert.equal(attempts, 2);
    assert.equal(committed.size, 1);
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
