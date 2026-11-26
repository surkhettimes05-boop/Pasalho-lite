import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DesktopLedger, generateTerminalKey } from './ledger.mjs';

const oneInstance = app.requestSingleInstanceLock();
if (!oneInstance) app.quit();
if (process.env.NODE_ENV === 'test' && process.env.PASALHO_DESKTOP_TEST_DIR) {
  mkdirSync(process.env.PASALHO_DESKTOP_TEST_DIR, { recursive: true });
  app.setPath('userData', process.env.PASALHO_DESKTOP_TEST_DIR);
}
let window, ledger, ledgerError, backendUrl;
const authSession = () => session.fromPartition('persist:pasalho-auth');
const ledgerPath = () => join(app.getPath('userData'), 'cash-ledger.sqlite');
const settingsPath = () => join(app.getPath('userData'), 'settings.json');

function requireLedger() {
  if (!ledger) throw new Error(ledgerError || 'Local ledger unavailable. Stop billing and restore a verified backup.');
  return ledger;
}

function normalizedBackend(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('Use a trusted HTTPS PASALHO Lite base URL.');
  return url.origin;
}

async function api(path, method = 'GET', body) {
  if (!backendUrl || !['/api/offline/provision', '/api/offline/sync', '/api/ready'].includes(path)) throw new Error('Backend is not configured.');
  if (ledger?.snapshot() && ledger.backendOrigin() !== backendUrl) throw new Error('Backend identity mismatch; synchronization blocked.');
  const response = await authSession().fetch(`${backendUrl}${path}`, {
    method, credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(12_000),
    headers: { origin: backendUrl, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (path === '/api/ready') return { ok: response.ok };
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.code || `HTTP ${response.status}`);
  return result;
}

function safe(handler) {
  return async (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== window.webContents.getURL() || !event.senderFrame.url.startsWith('file:')) throw new Error('IPC sender denied.');
    return handler(...args);
  };
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
function receiptHtml(sale) {
  const p = sale.payload;
  const snap = requireLedger().snapshotById(p.snapshotId);
  if (!snap) throw new Error('Historical product snapshot is missing. Stop printing and investigate the ledger.');
  const products = new Map(snap.products.map((item) => [item.productId, item]));
  const lines = p.items.map((item) => `<tr><td>${escapeHtml(products.get(item.productId)?.name || item.productId)} × ${item.quantity}</td><td>Rs ${(item.lineTotalCents / 100).toFixed(2)}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>body{font:12px monospace;width:72mm;margin:3mm}table{width:100%}td:last-child{text-align:right}hr{border:0;border-top:1px dashed #333}</style><h2>PASALHO</h2><p>${escapeHtml(snap.storeName)}<br>${escapeHtml(p.receiptNumber)}<br>${escapeHtml(p.createdAt)}<br>Cashier: ${escapeHtml(snap.cashierName)}</p><hr><table>${lines}</table><hr><p>Tax inclusive regular prices. No separate tax calculated.</p><h2>Total: Rs ${(p.subtotalCents / 100).toFixed(2)}</h2><p>Cash: Rs ${(p.payment.tenderedCents / 100).toFixed(2)}<br>Change: Rs ${((p.payment.tenderedCents - p.subtotalCents) / 100).toFixed(2)}</p><strong>${sale.state === 'SYNCED' ? 'SERVER CONFIRMED' : sale.state === 'REFUNDED' ? 'CASH REFUND RECORDED' : 'OFFLINE · LOCALLY COMPLETED · PENDING SERVER CONFIRMATION'}</strong><p>Transaction ${escapeHtml(p.transactionId)}</p>`;
}

async function printReceipt(id) {
  const sale = requireLedger().history().find((row) => row.id === id);
  if (!sale) throw new Error('Receipt not found in local ledger.');
  if (process.env.NODE_ENV === 'test' && process.env.PASALHO_DESKTOP_TEST_PRINT_FAIL === '1') return { printed: false, reason: 'simulated unavailable printer' };
  const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await printer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptHtml(sale))}`);
    return await new Promise((resolve) => printer.webContents.print({ silent: false, printBackground: false, margins: { marginType: 'none' } }, (success, failureReason) => resolve({ printed: success, reason: success ? null : failureReason || 'Printer cancelled or failed.' })));
  } finally { printer.destroy(); }
}

async function syncSales(includeReview = false) {
  const db = requireLedger();
  let processed = 0;
  for (const sale of db.pending(includeReview)) {
    const result = await api('/api/offline/sync', 'POST', { payload: sale.payload, signature: sale.signature });
    db.acknowledge(sale.id, result);
    processed++;
  }
  return { processed, status: db.status() };
}

function setupIpc() {
  ipcMain.handle('pos:status', safe(() => ({ ...(ledger ? ledger.status() : { provisioned: false, unlocked: false, snapshot: null, counts: [], sales: [] }), backendUrl, ledgerError: ledgerError || null })));
  ipcMain.handle('pos:configure', safe((value) => {
    if (requireLedger().snapshot() && backendUrl) throw new Error('Backend cannot change after terminal provisioning.');
    const origin = normalizedBackend(value);
    const db = requireLedger();
    if (db.snapshot() && db.backendOrigin() !== origin) throw new Error('Restored backend identity mismatch or missing legacy binding.');
    db.bindBackend(origin);
    backendUrl = origin;
    writeFileSync(settingsPath(), JSON.stringify({ backendUrl }), { flag: 'w', mode: 0o600 });
    return backendUrl;
  }));
  ipcMain.handle('pos:login', safe(() => {
    if (!backendUrl) throw new Error('Configure the PASALHO Lite URL first.');
    const login = new BrowserWindow({ parent: window, width: 850, height: 700, title: 'PASALHO sign in', webPreferences: { partition: 'persist:pasalho-auth', sandbox: true, contextIsolation: true, nodeIntegration: false } });
    login.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    login.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== backendUrl) event.preventDefault(); });
    login.webContents.on('will-redirect', (event, url) => { if (new URL(url).origin !== backendUrl) event.preventDefault(); });
    login.loadURL(`${backendUrl}/login`);
    return true;
  }));
  ipcMain.handle('pos:candidates', safe(() => api('/api/offline/provision')));
  ipcMain.handle('pos:provision', safe(async (input) => {
    const db = requireLedger();
    if (db.snapshot()) throw new Error('Terminal already provisioned.');
    if (!input || typeof input.passphrase !== 'string' || input.passphrase.length < 12 || typeof input.cashierEmail !== 'string' || !Array.isArray(input.approvedPrices) || !input.approvedPrices.length) throw new Error('Invalid owner provisioning request.');
    const { privateKeyPem, publicKeyJwk } = generateTerminalKey();
    const terminalId = randomUUID();
    const response = await api('/api/offline/provision', 'POST', { terminalId, cashierEmail: input.cashierEmail, publicKey: { kty: publicKeyJwk.kty, crv: publicKeyJwk.crv, x: publicKeyJwk.x, y: publicKeyJwk.y }, productIds: input.approvedPrices.map((p) => p.productId), approvedPrices: input.approvedPrices, taxInclusiveApproved: true });
    if (response.snapshot.terminalId !== terminalId) throw new Error('Provisioned terminal identity mismatch.');
    db.bindBackend(backendUrl);
    db.provision(response.snapshot, privateKeyPem, input.passphrase);
    return db.status();
  }));
  ipcMain.handle('pos:unlock', safe((passphrase) => requireLedger().unlock(passphrase)));
  ipcMain.handle('pos:lock', safe(() => { requireLedger().lock(); return requireLedger().status(); }));
  ipcMain.handle('pos:finalize', safe((input) => ({ ...requireLedger().finalize(input), status: requireLedger().status() })));
  ipcMain.handle('pos:sync', safe((includeReview) => {
    if (!requireLedger().status().unlocked) throw new Error('Unlock the terminal before synchronization.');
    return syncSales(includeReview === true);
  }));
  ipcMain.handle('pos:renew', safe(async (input) => {
    const db = requireLedger();
    if (!db.status().unlocked) throw new Error('Unlock the terminal.');
    if (db.status().counts.some((row) => row.state !== 'SYNCED' && row.state !== 'REFUNDED')) throw new Error('Resolve every local receipt before renewing the snapshot.');
    if (!input || !Array.isArray(input.approvedPrices)) throw new Error('Invalid renewal request.');
    const response = await api('/api/offline/provision', 'PUT', { terminalId: db.snapshot().terminalId, productIds: input.approvedPrices.map((p) => p.productId), approvedPrices: input.approvedPrices, taxInclusiveApproved: true });
    db.renew(response.snapshot);
    return db.status();
  }));
  ipcMain.handle('pos:print', safe(printReceipt));
  ipcMain.handle('pos:backup', safe(async (passphrase) => {
    const { canceled, filePath } = await dialog.showSaveDialog(window, { title: 'Save encrypted POS backup to an independent drive', defaultPath: `pasalho-pos-${new Date().toISOString().slice(0, 10)}.backup`, filters: [{ name: 'PASALHO backup', extensions: ['backup'] }] });
    if (canceled) return null;
    return requireLedger().backupTo(filePath, passphrase);
  }));
  ipcMain.handle('pos:restore', safe(async (passphrase) => {
    if (ledger?.snapshot()) throw new Error('Preserve the existing provisioned ledger and unsynchronized sales. Restore only on a replacement computer or a new data location.');
    const { canceled, filePaths } = await dialog.showOpenDialog(window, { title: 'Restore encrypted POS backup', properties: ['openFile'], filters: [{ name: 'PASALHO backup', extensions: ['backup'] }] });
    if (canceled) return null;
    const replacement = `${ledgerPath()}.${randomUUID()}.verified`;
    DesktopLedger.restoreFrom(filePaths[0], replacement, passphrase);
    ledger?.close();
    const preserved = `${ledgerPath()}.${randomUUID()}.preserved`;
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(`${ledgerPath()}${suffix}`)) renameSync(`${ledgerPath()}${suffix}`, `${preserved}${suffix}`);
    renameSync(replacement, ledgerPath());
    ledger = new DesktopLedger(ledgerPath()); ledgerError = null;
    backendUrl = ledger.backendOrigin();
    if (backendUrl) writeFileSync(settingsPath(), JSON.stringify({ backendUrl }), { mode: 0o600 });
    return { ...ledger.status(), backendUrl };
  }));
}

app.on('second-instance', () => window?.focus());
app.whenReady().then(() => {
  try { backendUrl = normalizedBackend(JSON.parse(readFileSync(settingsPath(), 'utf8')).backendUrl); } catch { backendUrl = null; }
  try { ledger = new DesktopLedger(ledgerPath()); } catch (error) { ledgerError = error.message; }
  if (ledger?.snapshot()) backendUrl = ledger.backendOrigin();
  setupIpc();
  window = new BrowserWindow({ width: 1200, height: 860, minWidth: 900, minHeight: 650, title: 'PASALHO POS', webPreferences: { preload: join(import.meta.dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.loadFile(join(import.meta.dirname, 'index.html'));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) window.show(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { ledger?.close(); });
