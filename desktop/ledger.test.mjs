import test from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { DesktopLedger, generateTerminalKey } from './ledger.mjs';

function fixture() {
  const now = new Date();
  return {
    version: 1, id: randomUUID(), terminalId: randomUUID(), storeId: randomUUID(), cashierId: randomUUID(),
    storeName: 'Surkhet', cashierName: 'Cashier', issuedAt: new Date(now.getTime() - 60_000).toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(), maxTotalCents: 5_000_000,
    taxPolicy: 'REGULAR_PRICE_TAX_INCLUSIVE',
    products: [{ productId: randomUUID(), sku: 'RICE-1', name: 'Rice', barcode: '123456789', unit: 'each', priceCents: 12500, availableUnits: 3 }],
  };
}

test('commits signed cash sale, stock movement and outbox atomically; survives restart and replay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pasalho-ledger-'));
  const path = join(dir, 'ledger.sqlite');
  try {
    const snapshot = fixture(), keys = generateTerminalKey();
    let ledger = new DesktopLedger(path);
    ledger.provision(snapshot, keys.privateKeyPem, 'a long terminal passphrase');
    const command = { transactionId: randomUUID(), items: [{ productId: snapshot.products[0].productId, quantity: 2 }], tenderedCents: 30000 };
    const first = ledger.finalize(command);
    assert.equal(first.payload.subtotalCents, 25000);
    assert.equal(verify('sha256', Buffer.from(JSON.stringify(first.payload)), { key: createPublicKey({ key: keys.publicKeyJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(first.signature, 'base64')), true);
    assert.equal(ledger.finalize(command).replay, true);
    assert.throws(() => ledger.finalize({ ...command, tenderedCents: 31000 }), /already used/);
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM sale').get().n, 1);
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM cash_payment').get().n, 1);
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM inventory_movement').get().n, 1);
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM audit').get().n, 1);
    assert.equal(ledger.pending().length, 1);
    assert.throws(() => ledger.db.prepare('UPDATE sale_item SET quantity=1').run(), /immutable item/);
    assert.throws(() => ledger.db.prepare('DELETE FROM sale_item').run(), /immutable item/);
    assert.throws(() => ledger.db.prepare('UPDATE cash_payment SET amount_cents=1').run(), /immutable payment/);
    assert.throws(() => ledger.finalize({ transactionId: randomUUID(), items: [{ productId: snapshot.products[0].productId, quantity: 2 }], tenderedCents: 30000 }), /stock is insufficient/);
    ledger.close();
    ledger = new DesktopLedger(path);
    assert.equal(ledger.pending().length, 1);
    assert.throws(() => ledger.finalize(command), /Unlock/);
    ledger.unlock('a long terminal passphrase');
    const second = ledger.finalize({ transactionId: randomUUID(), items: [{ productId: snapshot.products[0].productId, quantity: 1 }], tenderedCents: 12500 });
    assert.equal(ledger.pending().length, 2);
    ledger.acknowledge(first.payload.transactionId, { transactionId: first.payload.transactionId, status: 'SYNCED', saleId: first.payload.transactionId });
    assert.equal(ledger.pending().length, 1);
    assert.throws(() => ledger.acknowledge(second.payload.transactionId, { transactionId: first.payload.transactionId, status: 'SYNCED', saleId: second.payload.transactionId }), /does not match/);
    ledger.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('backup restores unsynchronized receipts on a replacement data location and rejects tampering', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pasalho-ledger-'));
  try {
    const original = join(dir, 'original.sqlite'), restored = join(dir, 'replacement.sqlite'), archive = join(dir, 'external.backup');
    const snapshot = fixture(), keys = generateTerminalKey();
    const ledger = new DesktopLedger(original);
    ledger.provision(snapshot, keys.privateKeyPem, 'terminal passphrase 123');
    const sale = ledger.finalize({ transactionId: randomUUID(), items: [{ productId: snapshot.products[0].productId, quantity: 1 }], tenderedCents: 12500 });
    const result = await ledger.backupTo(archive, 'independent backup phrase');
    assert.ok(result.sha256.length === 64);
    assert.equal(readFileSync(archive, 'utf8').includes(sale.payload.transactionId), false);
    assert.throws(() => DesktopLedger.restoreFrom(archive, restored, 'wrong backup phrase'), /auth|authenticate/i);
    DesktopLedger.restoreFrom(archive, restored, 'independent backup phrase');
    const recovered = new DesktopLedger(restored);
    assert.equal(recovered.pending().length, 1);
    recovered.unlock('terminal passphrase 123');
    assert.equal(recovered.finalize({ transactionId: sale.payload.transactionId, items: [{ productId: snapshot.products[0].productId, quantity: 1 }], tenderedCents: 12500 }).replay, true);
    assert.throws(() => DesktopLedger.restoreFrom(archive, restored, 'independent backup phrase'), /new data location/);
    recovered.close();
    ledger.close();
    const damaged = readFileSync(archive, 'utf8').replace(/.{10}$/, '0000000000');
    writeFileSync(archive, damaged);
    assert.throws(() => DesktopLedger.restoreFrom(archive, join(dir, 'damaged.sqlite'), 'independent backup phrase'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('expired approval and failed finalization leave no financial rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pasalho-ledger-'));
  try {
    const ledger = new DesktopLedger(join(dir, 'ledger.sqlite'));
    const snapshot = fixture(), keys = generateTerminalKey();
    ledger.provision(snapshot, keys.privateKeyPem, 'terminal passphrase 123');
    assert.throws(() => ledger.finalize({ transactionId: randomUUID(), items: [{ productId: snapshot.products[0].productId, quantity: 1 }], tenderedCents: 12500 }, new Date(Date.parse(snapshot.expiresAt) + 1)), /authorization expired/);
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM sale').get().n, 0);
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n, 0);
    ledger.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('50 offline sales reconcile cash, stock and outbox after abrupt process exit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pasalho-crash-'));
  const path = join(dir, 'ledger.sqlite');
  try {
    const snapshot = fixture(), keys = generateTerminalKey();
    snapshot.products[0].availableUnits = 100;
    const ledger = new DesktopLedger(path);
    ledger.provision(snapshot, keys.privateKeyPem, 'terminal passphrase 123');
    ledger.close();
    const commands = Array.from({length:50}, () => ({transactionId:randomUUID(),items:[{productId:snapshot.products[0].productId,quantity:1}],tenderedCents:15000}));
    const worker = `import { DesktopLedger } from ${JSON.stringify(new URL('./ledger.mjs', import.meta.url).href)};
const ledger = new DesktopLedger(${JSON.stringify(path)});
ledger.unlock('terminal passphrase 123');
for (const command of ${JSON.stringify(commands)}) ledger.finalize(command);
process.exit(0);`;
    const child = spawnSync(process.execPath, ['--input-type=module','-e',worker], {encoding:'utf8',timeout:30000});
    assert.equal(child.status,0,child.stderr);
    const recovered = new DesktopLedger(path);
    try {
      recovered.unlock('terminal passphrase 123');
      assert.equal(recovered.pending().length,50);
      for (const command of commands) assert.equal(recovered.finalize(command).replay,true);
      assert.equal(recovered.db.prepare('SELECT COUNT(*) AS n FROM sale').get().n,50);
      assert.equal(recovered.db.prepare('SELECT SUM(amount_cents) AS n FROM cash_payment').get().n,625000);
      assert.equal(recovered.db.prepare('SELECT SUM(quantity_delta) AS n FROM inventory_movement').get().n,-50);
      assert.equal(recovered.db.prepare('SELECT COUNT(*) AS n FROM audit').get().n,50);
      for (const command of commands) {
        const ack = {transactionId:command.transactionId,status:'SYNCED',saleId:command.transactionId};
        recovered.acknowledge(command.transactionId,ack);
        recovered.acknowledge(command.transactionId,ack);
      }
      assert.equal(recovered.pending().length,0);
      assert.equal(recovered.history().length,50);
    } finally { recovered.close(); }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
