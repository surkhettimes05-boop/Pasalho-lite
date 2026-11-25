"use strict";
const { test } = require("node:test"); // eslint-disable-line @typescript-eslint/no-require-imports
const assert = require("node:assert/strict"); // eslint-disable-line @typescript-eslint/no-require-imports
const { mkdtempSync, rmSync } = require("node:fs"); // eslint-disable-line @typescript-eslint/no-require-imports
const { tmpdir } = require("node:os"); // eslint-disable-line @typescript-eslint/no-require-imports
const { join } = require("node:path"); // eslint-disable-line @typescript-eslint/no-require-imports
const { randomUUID, randomBytes } = require("node:crypto"); // eslint-disable-line @typescript-eslint/no-require-imports
const { openLedger } = require("./ledger.cjs"); // eslint-disable-line @typescript-eslint/no-require-imports
test("committed encrypted envelopes survive reopening; replay cannot overwrite", () => {
  const directory = mkdtempSync(join(tmpdir(),"pasalho-ledger-"));
  const filename = join(directory,"ledger.sqlite");
  let ledger;
  try {
    ledger = openLedger(filename);
    const records = Array.from({length:50},()=>({id:randomUUID(),encryptedPayload:{iv:randomBytes(12).toString("base64"),ciphertext:randomBytes(48).toString("base64")},signature:randomBytes(64).toString("base64")}));
    for(const record of records) ledger.save(record);
    ledger.close(); ledger = openLedger(filename);
    assert.equal(ledger.list().length,50);
    assert.deepEqual(ledger.recover(), records.map(record=>({...record,state:"PENDING_SYNC"})));
    ledger.save(records[0]);
    assert.equal(ledger.list().length,50);
    assert.throws(()=>ledger.save({...records[0],signature:randomBytes(64).toString("base64")}),/Conflicting transaction ID/);
    assert.equal(ledger.get(records[0].id).signature,records[0].signature);
    assert.throws(()=>ledger.save({...records[0],id:"invalid"}),/Invalid/);
  } finally { ledger?.close(); rmSync(directory,{recursive:true,force:true}); }
});
