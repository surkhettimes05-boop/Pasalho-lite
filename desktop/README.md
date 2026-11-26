# PASALHO Windows cash register — review build

This Electron application uses a local SQLite ledger for the D-022 offline
cash exception. Its UI is a bundled local page; billing does not call Next.js,
PostgreSQL, Modern Trade, or the internet. The existing Lite server remains
authoritative when signed receipts synchronize. The desktop app cannot provide
member prices, promotions, loyalty, COD, QR payment, or returns while offline.

## Review build

On Windows x64 with Node available:

```powershell
cd desktop
npm ci
npm test
node --test electron-smoke.mjs
npm run make
```

Forge writes a Squirrel installer under `desktop/out/make/squirrel.windows/x64`.
It is an unsigned review artifact. Do not publish or install it at the store
until signing, update preservation, hardware, backup, and network drills pass.
The app data path is Electron's `userData`, outside the installed application
directory. Updates must never remove or replace that path. Automatic updates
are not enabled.

## Owner provisioning and daily use

1. Enter the trusted PASALHO Lite HTTPS base URL. Open the isolated sign-in
   window and sign in as Owner/Admin. The local POS window does not receive
   the website session cookie or unrestricted network access.
2. Load the Modern Trade regular-price catalog through the existing Lite
   provisioning endpoint. Review the selected SKU prices, choose a cashier,
   and enter a terminal passphrase of at least 12 characters.
3. The main process generates a P-256 signing key, registers its public key
   with Lite, and stores the private key encrypted in SQLite. If online
   registration succeeds but local provisioning fails, revoke that orphan
   terminal before retrying.
4. Make an encrypted backup to a **different physical medium** and verify a
   restore on a spare test location before relying on the terminal. Keep both
   terminal and backup passphrases in the store's controlled handover process.
5. Scan a barcode into the search field, press Enter, enter cash tendered,
   and finalize. The app returns success only after one SQLite transaction
   commits sale, cash payment, stock movement, audit, and outbox records.
   The local price comes only from the approved server snapshot. Authorization
   expires after eight hours; a clock rollback beyond five minutes stops
   billing. Local available stock is provisional.
6. Printing happens **after** the commit. A printer failure leaves the sale
   saved. Reprint from local history; never finalize another sale to fix a
   paper failure.
7. When connectivity returns, sign in to Lite as the assigned cashier or
   owner, press Sync, and inspect every `CONFLICT` or `REQUIRES_REVIEW` receipt
   in the owner review page. Sync retries keep the original transaction UUID,
   payload, and signature. Resolve cash and stock before daily close.
8. Renew only after all local receipts are confirmed or refunded. Review the
   fresh Modern Trade prices online before accepting a new snapshot.

## Backup, restore, and failed updates

The backup command uses SQLite's online backup API, runs `integrity_check`,
encrypts the whole backup with AES-256-GCM and PBKDF2, and fsyncs the archive.
The app never overwrites an existing backup file. Copy it to independent
media; a backup left only on the POS disk does not cover device loss.

Restore verifies the authenticated archive and SQLite integrity before use.
It refuses to replace a provisioned local ledger. On a replacement Windows
computer, install the same reviewed version, choose Restore, enter the backup
passphrase, then unlock with the terminal passphrase. Sync and reconcile every
pending receipt. Any existing unprovisioned or corrupt database is preserved
with a `.preserved` suffix for investigation. Never delete the old device's
ledger or paper receipts until all unsynchronized sales are reconciled.

For a failed installer update, reinstall the prior reviewed installer without
deleting Electron `userData`; unlock and verify receipt count, pending outbox,
and SQLite integrity. Restore from independent backup only on a clean data
location if local data cannot open. No production installer or update has been
certified yet.

## Physical store acceptance checklist

Record date, Windows version, machine identifier, operator, scanner model,
printer model/driver, network, installer hash, ledger path, and backup medium.

- [ ] Install and launch the review build, provision with owner approval, and
      verify store, cashier, expiry, SKU whitelist, and approved tax-inclusive
      regular prices.
- [ ] Scan several real shelf barcodes with the USB keyboard-wedge scanner;
      confirm each exact SKU and quantity in the cart.
- [ ] Print a real receipt on the Windows thermal printer. Check width,
      legibility, transaction ID, line prices, total, cash, change, and the
      provisional offline notice.
- [ ] Disconnect internet, stop the Lite app and PostgreSQL separately, and
      confirm eligible cash sales persist and print without either service.
- [ ] Simulate printer offline. Confirm sale is saved once, then reprint the
      same receipt when the printer returns.
- [ ] Restart the app with pending receipts and verify identical UUIDs,
      amounts, stock projection, audit rows, and outbox count.
- [ ] Verify two offline sales, insufficient local stock, expiry, clock
      rollback, duplicate finalization, and interrupted response recovery.
- [ ] Restore an encrypted backup to a spare machine or clean data location;
      verify pending receipts and signing key unlock. Test a damaged archive.
- [ ] Install an update while receipts are pending; verify userData survives.
      Roll back the update and repeat the check.
- [ ] Reconnect and sync repeatedly. Verify one cloud sale, payment, and stock
      movement per receipt, plus visible conflict settlement and daily close.
- [ ] Reconcile physical cash, paper receipts, and counted stock to both local
      and cloud ledgers. Record discrepancies and owner sign-off.

## Current evidence and limits

`node --test desktop/ledger.test.mjs` exercises atomic local records, signing,
replay, stock, restart, expiry, backup/restore, and archive tamper rejection.
`node --test desktop/electron-smoke.mjs` exercises the Windows UI with keyboard
scanner input, an offline sale, simulated printer failure, and restart. This
is **not** evidence of actual USB scanner or printer hardware, a production
installer update, real cloud outage, or independent-media recovery. Those
checks remain release blockers. The local SQLite file is not encrypted as a
whole; the signing key and exported backup are encrypted. A compromised
Windows administrator can alter local storage, so store access controls and
cloud reconciliation remain necessary.
