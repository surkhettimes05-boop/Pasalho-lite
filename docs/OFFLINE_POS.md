# Offline cash POS — scoped D-022 implementation

## Authorization and pricing

An Owner/Admin signs in online and opens `/offline-pos.html` from the POS page.
Provisioning calls the existing Modern Trade catalog API, matches SKUs to active
Lite products, and displays the regular prices. The owner selects the allowed
SKUs, assigns one active cashier, confirms that the regular prices are tax
inclusive, and sets a terminal passphrase of at least 12 characters. A device
ECDSA P-256 key is generated in the browser; its private key is nonextractable
and held in IndexedDB, while its public key, store, assigned cashier, owner,
and approval audit are stored in PostgreSQL. The server creates an immutable
eight-hour snapshot of selected SKUs, barcodes, regular prices, local available
stock, and policy. Its price source is Modern Trade, never Lite's selling price.
The owner-reviewed price list is submitted with the approval; if the catalog
changes between review and submission, the server rejects it for re-review.

The snapshot is encrypted locally with AES-GCM using a key derived from the
passphrase with PBKDF2-SHA-256. The passphrase and derived key are held only in
memory while the terminal is unlocked. The private signing key stays in
IndexedDB. No API token, password, or customer personal information is stored
in the offline database. Browser encryption limits exposure to casual disk
inspection; it does not secure a compromised browser or unlocked device.

Only anonymous, whole-unit, cash sales are supported offline. No QR, COD,
customer lookup, membership price, promotion, loyalty, return, or refund is
permitted. The current regular price is treated as tax inclusive and no
separate tax amount is calculated. A sale is capped at NPR 50,000. The local
stock projection subtracts all locally completed sales for the snapshot,
including conflict cases. The local balance is provisional because another
terminal or online order can consume the same physical stock.

## Local completion and reconciliation

The static shell and script are cached by a service worker on first online
visit. The terminal requires browser persistent storage before provisioning
and before every sale. Each sale gets a UUID and receipt number, immutable
line/price/payment snapshots, and an ECDSA signature. The encrypted payload,
signature, and `PENDING_SYNC` state are committed to IndexedDB and read back
before a local completion or printable receipt is shown. Storage failure stops
billing. Refresh or browser restart requires the passphrase; stored sales and
the interrupted `SYNCING` state can then resume. Pending sales are never
automatically deleted. A browser Web Lock serializes sale writes across tabs
on the same device; browsers without this API cannot finalize offline sales.

When the backend is reachable, the foreground uploads pending signed payloads
over the same-origin authenticated session. The service worker's Background
Sync event nudges an open terminal window. Because the payload is encrypted
and its passphrase key exists only in that window's memory, a closed browser
cannot upload in the background. Foreground retry occurs on reconnect, every
30 seconds while open, and when staff presses Retry.

The ingestion route validates the signed payload, registered terminal, active
cashier, store, snapshot period, selected products, prices, integer totals,
cash method, and transaction ID. A serializable PostgreSQL transaction creates
the `Sale`, `SaleItem`, `Payment`, one `POS_SALE` InventoryMovement per line,
StockBalance updates, immutable submission record, and AuditLog. The sale ID
is the original offline transaction UUID. Duplicate submissions return the
stored result; an altered payload with the same ID is rejected. A local sale
becomes `SYNCED` only after the route returns the matching transaction and
sale IDs from a committed transaction. Interrupted requests are retried.

Insufficient stock becomes `CONFLICT` with no sale or stock deduction. A
revoked device, changed cashier role, expired snapshot, clock mismatch,
deactivated product, late submission, or already-closed operating day becomes
`REQUIRES_REVIEW`. The signed payload and audit evidence remain in PostgreSQL
for owner investigation. A conflict is not retried automatically and a
completed receipt or cash amount is never silently rewritten. The owner must
count physical stock and cash, investigate duplicate or missing receipts,
then use the supported adjustment/return/cash workflows as appropriate.
There is no automatic conflict settlement in this change.

## Daily operation and recovery

1. Visit the offline shell online, verify service-worker installation and
   storage persistence, provision the terminal, and complete a real printer
   test before relying on it.
2. Keep the terminal passphrase with the assigned cashier through the store's
   secure handover process. Do not enter it on a shared/untrusted device.
3. During an outage, use only the offline cash register. Printed receipts say
   **OFFLINE · Locally completed · Pending server confirmation**.
4. On reconnection, sign in as the assigned cashier, unlock the terminal, and
   wait for `SYNCED`. Investigate every `CONFLICT` or `REQUIRES_REVIEW` item.
5. Before daily close, confirm there are no pending local receipts. The server
   blocks synchronization into a closed operating day for manual review.
6. Renew the approved snapshot online as Owner/Admin only after every local
   sale is `SYNCED`. Renewal fetches fresh Modern Trade prices and server stock.
7. If a device is stolen, revoke it from the provision endpoint while signed
   in as Owner/Admin. Already printed local receipts must still be collected
   and reviewed. Revocation cannot erase a lost device's local data remotely.

If the internet, app backend, or PostgreSQL fails, an initialized unlocked
terminal continues eligible local cash billing until authorization expiry or
storage failure. If the browser restarts, unlock with the passphrase and the
outbox resumes. If the device or browser profile is lost before synchronization,
IndexedDB transactions may be irrecoverable; reconcile paper receipts, cash,
and physical stock manually. If a receipt printer is unsupported, use the
browser print dialog only after confirming an alternative receipt process.
Reprinting from local history does not create another sale.

## Browser and release limitations

IndexedDB persistent-storage permission reduces eviction risk but is not a
durability guarantee. Private browsing, profile deletion, browser bugs,
storage corruption, quota failure, OS reinstall, device theft, or device loss
can destroy unsynchronized sales. Browser clocks and signing keys can be
manipulated on compromised devices. The browser print dialog is not a tested
ESC/POS or fiscal-printer integration. A second terminal and online orders
can conflict with provisional stock. No portable encrypted recovery export or
installed POS runtime is implemented.

For a production durability guarantee across device failure, use an installed
POS runtime with an encrypted, fsynced local transaction log and tested backup
or replication to a second local medium, plus a locally verified operator
credential and controlled clock. That runtime and hardware tests remain launch
blockers. This browser implementation must be treated as a reviewable pilot,
not declared production ready on automated tests alone.

## Acceptance evidence still required

The integration suite covers an online approved price snapshot, signed cash
ingestion, idempotent replay, ledger/payment/loyalty checks, historical price
preservation, expiry/revocation review, and two-terminal stock conflict. Before
launch, run store hardware tests and a recovery exercise. The browser suite
uses real Edge/IndexedDB and simulated network outages, with fixture responses
for provisioning and synchronization. The HTTP E2E test exercises the actual
Next routes, authentication, PostgreSQL transaction, and idempotent replay
while a local Modern Trade catalog fixture is stopped before synchronization.
Still test a real PostgreSQL outage, quota exhaustion, interrupted requests,
and the live Modern Trade catalog before release. Record results in the release
report without treating fixture pricing as proof of live Modern Trade behavior.
Run `npm run test:isolated` against local `.env.test` for a fresh migrated and
seeded PostgreSQL database. Run `npm run test:e2e:offline` for the browser
suite and `npm run test:e2e:offline-http` for real Next route reconciliation.
The browser suite uses Edge if found at the standard Windows location; set
`PASALHO_E2E_BROWSER_PATH` or install Playwright Chromium on other machines.

## Rollback

Disable links to `/offline-pos.html`, deploy the previous application commit,
and revoke provisioned terminals. Do not delete local unsynchronized sales;
preserve devices and printed receipts for reconciliation. The migration only
adds tables and relations, so leave it in place during application rollback.
Do not drop it until every local transaction and review record is resolved and
backups have been verified. Follow `docs/OPERATIONS_RUNBOOK.md` for database
backup and restore policy.
