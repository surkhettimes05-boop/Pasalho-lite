"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { randomUUID, randomBytes } = require("node:crypto");
const { openLedger } = require("./ledger.cjs");
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
    ledger.save(records[0]);
    assert.equal(ledger.list().length,50);
    assert.throws(()=>ledger.save({...records[0],signature:randomBytes(64).toString("base64")}),/Conflicting transaction ID/);
    assert.equal(ledger.get(records[0].id).signature,records[0].signature);
    assert.throws(()=>ledger.save({...records[0],id:"invalid"}),/Invalid/);
  } finally { ledger?.close(); rmSync(directory,{recursive:true,force:true}); }
});
