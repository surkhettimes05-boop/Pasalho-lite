"use strict";
const { DatabaseSync } = require("node:sqlite");
const { createHash } = require("node:crypto");

function openLedger(filename) {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
  db.exec(`CREATE TABLE IF NOT EXISTS sale_envelope (
    id TEXT PRIMARY KEY, iv TEXT NOT NULL, ciphertext TEXT NOT NULL,
    signature TEXT NOT NULL, digest TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'PENDING_SYNC'
      CHECK(state IN ('PENDING_SYNC','SYNCED','CONFLICT','REQUIRES_REVIEW','REFUNDED'))
  ) STRICT;`);
  const get = db.prepare("SELECT * FROM sale_envelope WHERE id=?");
  const insert = db.prepare("INSERT INTO sale_envelope(id,iv,ciphertext,signature,digest) VALUES(?,?,?,?,?)");
  function save(record) {
    const { id, encryptedPayload, signature } = record;
    const { iv, ciphertext } = encryptedPayload ?? {};
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) ||
        typeof iv !== "string" || !/^[A-Za-z0-9+/]{16}$/.test(iv) ||
        typeof ciphertext !== "string" || ciphertext.length < 24 || ciphertext.length > 2000000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext) ||
        typeof signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(signature))
      throw new Error("Invalid encrypted sale envelope");
    const digest = createHash("sha256").update(JSON.stringify([iv,ciphertext,signature])).digest("hex");
    db.exec("BEGIN IMMEDIATE");
    try {
      const old = get.get(id);
      if (old && old.digest !== digest) throw new Error("Conflicting transaction ID");
      if (!old) insert.run(id,iv,ciphertext,signature,digest);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return get.get(id);
  }
  return { save, get: id => get.get(id), list: () => db.prepare("SELECT * FROM sale_envelope ORDER BY rowid").all(), close: () => db.close() };
}
module.exports = { openLedger };
