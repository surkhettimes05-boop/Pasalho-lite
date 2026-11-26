import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, pbkdf2Sync, randomBytes, randomUUID, sign, verify } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const POLICY = 'REGULAR_PRICE_TAX_INCLUSIVE';
const KDF_ROUNDS = 310_000;
const STATES = new Set(['SYNCED', 'CONFLICT', 'REQUIRES_REVIEW', 'REFUNDED']);
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const positiveInt = (value) => Number.isSafeInteger(value) && value > 0;
const iso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const hash = (value) => createHash('sha256').update(value).digest('hex');

function seal(text, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12) throw new Error('Passphrase must contain at least 12 characters.');
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = pbkdf2Sync(passphrase, salt, KDF_ROUNDS, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(text), cipher.final()]);
  return JSON.stringify({ version: 1, rounds: KDF_ROUNDS, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
}

function unseal(box, passphrase) {
  const parsed = JSON.parse(box);
  if (parsed.version !== 1 || parsed.rounds !== KDF_ROUNDS) throw new Error('Unsupported encrypted data.');
  const key = pbkdf2Sync(passphrase, Buffer.from(parsed.salt, 'base64'), parsed.rounds, 32, 'sha256');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parsed.ciphertext, 'base64')), decipher.final()]);
}

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !uuid(snapshot.id) || !uuid(snapshot.terminalId) || !uuid(snapshot.storeId) || !uuid(snapshot.cashierId) || !iso(snapshot.issuedAt) || !iso(snapshot.expiresAt) || snapshot.taxPolicy !== POLICY || snapshot.maxTotalCents !== 5_000_000 || !Array.isArray(snapshot.products) || !snapshot.products.length || snapshot.products.length > 1000 || !snapshot.storeName || !snapshot.cashierName) throw new Error('Invalid approved offline snapshot.');
  if (Date.parse(snapshot.expiresAt) - Date.parse(snapshot.issuedAt) > 8 * 60 * 60_000 || Date.parse(snapshot.expiresAt) <= Date.parse(snapshot.issuedAt)) throw new Error('Invalid snapshot validity.');
  const ids = new Set();
  for (const p of snapshot.products) {
    if (!uuid(p.productId) || !p.sku || !p.name || !positiveInt(p.priceCents) || !Number.isSafeInteger(p.availableUnits) || p.availableUnits < 0 || ids.has(p.productId)) throw new Error('Invalid approved product.');
    ids.add(p.productId);
  }
}

export function generateTerminalKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKeyJwk: publicKey.export({ format: 'jwk' }) };
}

export class DesktopLedger {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.path = path;
    this.db = new DatabaseSync(path, { timeout: 5000 });
    try {
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    if (this.db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('SQLite integrity check failed. Stop billing and restore a verified backup.');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS backend_identity (id INTEGER PRIMARY KEY CHECK(id=1), origin TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS immutable_backend_update BEFORE UPDATE ON backend_identity BEGIN SELECT RAISE(ABORT,'immutable backend identity'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_backend_delete BEFORE DELETE ON backend_identity BEGIN SELECT RAISE(ABORT,'immutable backend identity'); END;
      CREATE TABLE IF NOT EXISTS terminal (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, cashier_id TEXT NOT NULL, encrypted_key TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshot (id TEXT PRIMARY KEY, terminal_id TEXT NOT NULL REFERENCES terminal(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sale (id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES snapshot(id), payload TEXT NOT NULL, signature TEXT NOT NULL, command_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sale_item (sale_id TEXT NOT NULL REFERENCES sale(id), product_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), price_cents INTEGER NOT NULL CHECK(price_cents>0), line_cents INTEGER NOT NULL CHECK(line_cents>0), PRIMARY KEY(sale_id,product_id));
      CREATE TABLE IF NOT EXISTS cash_payment (sale_id TEXT PRIMARY KEY REFERENCES sale(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>0), tendered_cents INTEGER NOT NULL CHECK(tendered_cents>=amount_cents));
      CREATE TABLE IF NOT EXISTS inventory_movement (sale_id TEXT NOT NULL REFERENCES sale(id), product_id TEXT NOT NULL, quantity_delta INTEGER NOT NULL CHECK(quantity_delta<0), PRIMARY KEY(sale_id,product_id));
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sale(id), event TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (sale_id TEXT PRIMARY KEY REFERENCES sale(id), state TEXT NOT NULL CHECK(state IN ('PENDING_SYNC','SYNCED','CONFLICT','REQUIRES_REVIEW','REFUNDED')), reason TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS clock_guard (id INTEGER PRIMARY KEY CHECK(id=1), last_seen TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS immutable_sale_update BEFORE UPDATE ON sale BEGIN SELECT RAISE(ABORT,'immutable sale'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_sale_delete BEFORE DELETE ON sale BEGIN SELECT RAISE(ABORT,'immutable sale'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_item_update BEFORE UPDATE ON sale_item BEGIN SELECT RAISE(ABORT,'immutable item'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_item_delete BEFORE DELETE ON sale_item BEGIN SELECT RAISE(ABORT,'immutable item'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_payment_update BEFORE UPDATE ON cash_payment BEGIN SELECT RAISE(ABORT,'immutable payment'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_payment_delete BEFORE DELETE ON cash_payment BEGIN SELECT RAISE(ABORT,'immutable payment'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_movement_update BEFORE UPDATE ON inventory_movement BEGIN SELECT RAISE(ABORT,'immutable movement'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_movement_delete BEFORE DELETE ON inventory_movement BEGIN SELECT RAISE(ABORT,'immutable movement'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_audit_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_audit_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
    `);
    this.privateKey = null;
    } catch (error) { this.db.close(); throw error; }
  }

  backendOrigin() {
    return this.db.prepare('SELECT origin FROM backend_identity WHERE id=1').get()?.origin ?? null;
  }

  bindBackend(origin) {
    const url = new URL(origin);
    if (url.origin !== origin || (url.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' && url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw new Error('Invalid backend origin.');
    const existing = this.backendOrigin();
    if (existing && existing !== origin) throw new Error('Backend identity mismatch.');
    this.db.prepare('INSERT OR IGNORE INTO backend_identity VALUES (1,?)').run(origin);
  }

  provision(snapshot, privateKeyPem, passphrase) {
    validateSnapshot(snapshot);
    if (this.db.prepare('SELECT id FROM terminal LIMIT 1').get()) throw new Error('Terminal already provisioned.');
    const privateKey = createPrivateKey(privateKeyPem);
    const challenge = Buffer.from(snapshot.terminalId);
    const proof = sign('sha256', challenge, { key: privateKey, dsaEncoding: 'ieee-p1363' });
    if (!verify('sha256', challenge, { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, proof)) throw new Error('Invalid terminal key.');
    const encrypted = seal(Buffer.from(privateKeyPem), passphrase);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO terminal VALUES (?,?,?,?,?)').run(snapshot.terminalId, snapshot.storeId, snapshot.cashierId, encrypted, new Date().toISOString());
      this.db.prepare('INSERT INTO snapshot VALUES (?,?,?,?)').run(snapshot.id, snapshot.terminalId, JSON.stringify(snapshot), new Date().toISOString());
      this.db.prepare('INSERT INTO clock_guard VALUES (1,?)').run(snapshot.issuedAt);
      this.db.exec('COMMIT');
      this.privateKey = privateKey;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  unlock(passphrase) {
    const row = this.db.prepare('SELECT encrypted_key FROM terminal LIMIT 1').get();
    if (!row) throw new Error('Terminal has not been provisioned.');
    this.privateKey = createPrivateKey(unseal(row.encrypted_key, passphrase));
    return this.status();
  }

  lock() { this.privateKey = null; }

  snapshot() {
    const row = this.db.prepare('SELECT body FROM snapshot ORDER BY created_at DESC, rowid DESC LIMIT 1').get();
    return row ? JSON.parse(row.body) : null;
  }

  snapshotById(id) {
    const row = this.db.prepare('SELECT body FROM snapshot WHERE id=?').get(id);
    return row ? JSON.parse(row.body) : null;
  }

  renew(snapshot) {
    validateSnapshot(snapshot);
    const terminal = this.db.prepare('SELECT * FROM terminal LIMIT 1').get();
    if (!this.privateKey || !terminal || snapshot.terminalId !== terminal.id || snapshot.storeId !== terminal.store_id || snapshot.cashierId !== terminal.cashier_id) throw new Error('Terminal authorization mismatch.');
    if (this.db.prepare("SELECT 1 FROM outbox WHERE state NOT IN ('SYNCED','REFUNDED') LIMIT 1").get()) throw new Error('Resolve every local sale before renewal.');
    this.db.prepare('INSERT INTO snapshot VALUES (?,?,?,?)').run(snapshot.id, snapshot.terminalId, JSON.stringify(snapshot), new Date().toISOString());
  }

  status() {
    const counts = this.db.prepare('SELECT state, COUNT(*) AS count FROM outbox GROUP BY state').all();
    return { provisioned: !!this.snapshot(), unlocked: !!this.privateKey, snapshot: this.snapshot(), counts, sales: this.history() };
  }

  history() {
    return this.db.prepare('SELECT s.id, s.payload, o.state, o.reason FROM sale s JOIN outbox o ON o.sale_id=s.id ORDER BY s.created_at DESC').all().map((r) => ({ id: r.id, payload: JSON.parse(r.payload), state: r.state, reason: r.reason }));
  }

  finalize(command, now = new Date()) {
    if (!this.privateKey) throw new Error('Unlock the terminal before billing.');
    const snapshot = this.snapshot();
    if (!snapshot) throw new Error('Terminal has not been provisioned.');
    if (!uuid(command?.transactionId) || !Array.isArray(command.items) || command.items.length < 1 || command.items.length > 100 || !Number.isSafeInteger(command.tenderedCents) || command.tenderedCents < 0) throw new Error('Invalid cash sale request.');
    const commandHash = hash(JSON.stringify(command));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare('SELECT payload,signature,command_hash FROM sale WHERE id=?').get(command.transactionId);
      if (existing) {
        if (existing.command_hash !== commandHash) throw new Error('Transaction ID was already used for another sale.');
        this.db.exec('COMMIT');
        return { payload: JSON.parse(existing.payload), signature: existing.signature, replay: true };
      }
      if (now.getTime() < Date.parse(snapshot.issuedAt) - 5 * 60_000 || now.getTime() > Date.parse(snapshot.expiresAt)) throw new Error('Offline authorization expired or device clock changed.');
      const lastSeen = this.db.prepare('SELECT last_seen FROM clock_guard WHERE id=1').get();
      if (!lastSeen || now.getTime() < Date.parse(lastSeen.last_seen) - 5 * 60_000) throw new Error('Device clock moved backward. Stop billing and contact the owner.');
      const byId = new Map(snapshot.products.map((p) => [p.productId, p]));
      const seen = new Set();
      let total = 0;
      const items = command.items.map((item) => {
        const product = byId.get(item.productId);
        if (!product || seen.has(item.productId) || !positiveInt(item.quantity) || item.quantity > 1000) throw new Error('Invalid approved sale item.');
        seen.add(item.productId);
        const used = this.db.prepare('SELECT COALESCE(-SUM(m.quantity_delta),0) AS units FROM inventory_movement m JOIN sale s ON s.id=m.sale_id WHERE s.snapshot_id=? AND m.product_id=?').get(snapshot.id, item.productId).units;
        if (item.quantity > product.availableUnits - used) throw new Error('Local stock is insufficient.');
        const lineTotalCents = product.priceCents * item.quantity;
        if (!Number.isSafeInteger(lineTotalCents)) throw new Error('Sale amount overflow.');
        total += lineTotalCents;
        return { productId: item.productId, quantity: item.quantity, priceCents: product.priceCents, lineTotalCents };
      });
      if (!positiveInt(total) || total > snapshot.maxTotalCents || command.tenderedCents < total) throw new Error('Cash sale exceeds the approved limit or tender is insufficient.');
      const payload = { version: 1, transactionId: command.transactionId, snapshotId: snapshot.id, terminalId: snapshot.terminalId, storeId: snapshot.storeId, cashierId: snapshot.cashierId, createdAt: now.toISOString(), receiptNumber: `OFF-${command.transactionId.toUpperCase()}`, items, subtotalCents: total, discountCents: 0, taxPolicy: POLICY, payment: { method: 'CASH', tenderedCents: command.tenderedCents } };
      const payloadText = JSON.stringify(payload);
      const signature = sign('sha256', Buffer.from(payloadText), { key: this.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
      this.db.prepare('INSERT INTO sale VALUES (?,?,?,?,?,?)').run(command.transactionId, snapshot.id, payloadText, signature, commandHash, payload.createdAt);
      for (const item of items) {
        this.db.prepare('INSERT INTO sale_item VALUES (?,?,?,?,?)').run(command.transactionId, item.productId, item.quantity, item.priceCents, item.lineTotalCents);
        this.db.prepare('INSERT INTO inventory_movement VALUES (?,?,?)').run(command.transactionId, item.productId, -item.quantity);
      }
      this.db.prepare('INSERT INTO cash_payment VALUES (?,?,?)').run(command.transactionId, total, command.tenderedCents);
      this.db.prepare('INSERT INTO audit VALUES (?,?,?,?,?)').run(randomUUID(), command.transactionId, 'LOCAL_CASH_SALE_COMMITTED', JSON.stringify({ payloadHash: hash(payloadText), amountCents: total }), payload.createdAt);
      this.db.prepare('INSERT INTO outbox VALUES (?,?,?,?)').run(command.transactionId, 'PENDING_SYNC', null, payload.createdAt);
      this.db.prepare('UPDATE clock_guard SET last_seen=MAX(last_seen,?) WHERE id=1').run(payload.createdAt);
      this.db.exec('COMMIT');
      return { payload, signature, replay: false };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  pending(includeReview = false) {
    const states = includeReview ? "('PENDING_SYNC','CONFLICT','REQUIRES_REVIEW')" : "('PENDING_SYNC')";
    return this.db.prepare(`SELECT s.id,s.payload,s.signature FROM sale s JOIN outbox o ON o.sale_id=s.id WHERE o.state IN ${states} ORDER BY s.created_at`).all();
  }

  acknowledge(id, response) {
    if (!uuid(id) || !response || response.transactionId !== id || !STATES.has(response.status) || (response.status === 'SYNCED' && response.saleId !== id) || (response.status === 'REFUNDED' && response.saleId !== null)) throw new Error('Server acknowledgment does not match the local sale.');
    const row = this.db.prepare('SELECT state FROM outbox WHERE sale_id=?').get(id);
    if (!row) throw new Error('Unknown local sale.');
    if (row.state === 'SYNCED' || row.state === 'REFUNDED') {
      if (row.state !== response.status) throw new Error('Conflicting server acknowledgment.');
      return;
    }
    this.db.prepare('UPDATE outbox SET state=?,reason=?,updated_at=? WHERE sale_id=?').run(response.status, response.reason ?? null, new Date().toISOString(), id);
  }

  async backupTo(destination, passphrase) {
    if (existsSync(destination)) throw new Error('Backup destination already exists.');
    const temp = `${this.path}.${randomUUID()}.backup-temp.sqlite`;
    const sealedTemp = `${destination}.${randomUUID()}.partial`;
    try {
      await sqliteBackup(this.db, temp);
      const check = new DatabaseSync(temp, { readOnly: true });
      const good = check.prepare('PRAGMA integrity_check').get().integrity_check === 'ok';
      check.close();
      if (!good) throw new Error('Backup integrity verification failed.');
      const encrypted = seal(readFileSync(temp), passphrase);
      const fd = openSync(sealedTemp, 'wx', 0o600);
      try { writeFileSync(fd, encrypted); fsyncSync(fd); } finally { closeSync(fd); }
      const { linkSync } = await import('node:fs');
      try { linkSync(sealedTemp, destination); }
      catch (error) {
        if (!['EPERM','ENOTSUP','EOPNOTSUPP','ENOSYS','EXDEV','EINVAL'].includes(error.code)) throw error;
        // FAT/exFAT fallback: exclusive creation, never overwrite an existing archive.
        const output = openSync(destination, 'wx', 0o600);
        try {
          try { writeFileSync(output, encrypted); fsyncSync(output); }
          finally { closeSync(output); }
          if (hash(readFileSync(destination)) !== hash(encrypted)) throw new Error('Backup readback mismatch.');
        } catch (failure) { rmSync(destination, {force:true}); throw failure; }
      }
      return { destination, sha256: hash(encrypted), bytes: Buffer.byteLength(encrypted) };
    } finally { rmSync(temp, { force: true }); rmSync(sealedTemp, { force: true }); }
  }

  static restoreFrom(source, destination, passphrase) {
    if (existsSync(destination)) throw new Error('Restore only to a new data location; preserve the existing ledger and unsynchronized sales.');
    mkdirSync(dirname(destination), { recursive: true });
    const temp = `${destination}.${randomUUID()}.restoring`;
    try {
      const plain = unseal(readFileSync(source, 'utf8'), passphrase);
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, plain); fsyncSync(fd); } finally { closeSync(fd); }
      const check = new DatabaseSync(temp, { readOnly: true });
      const good = check.prepare('PRAGMA integrity_check').get().integrity_check === 'ok' && !!check.prepare('SELECT id FROM terminal LIMIT 1').get();
      check.close();
      if (!good) throw new Error('Restored ledger failed integrity verification.');
      renameSync(temp, destination);
    } finally { rmSync(temp, { force: true }); }
  }

  close() { this.privateKey = null; this.db.close(); }
}
