# Pasalho Lite V1 — Scanner & Printer Validation

These checks require the actual store hardware and cannot be truthfully verified in CI.

## Barcode scanner

Use the exact scanner intended for launch.

1. Place cursor in POS product/barcode search.
2. Scan 20 known products.
3. Confirm each scan resolves the correct SKU.
4. Scan the same barcode rapidly 10 times and verify the UI does not freeze.
5. Scan an unknown barcode and verify no wrong product is selected.
6. Confirm scanner suffix/Enter behavior does not accidentally finalize a sale.
7. Test after browser refresh and staff re-login.

Record scanner model, browser, operating system, date and result.

## Receipt printer

Use the exact printer intended for launch.

1. Finalize a small cash sale.
2. Open the persisted receipt.
3. Print it using the production browser/OS print path.
4. Confirm receipt number, items, quantity, unit price, total, payment method and customer identity if present.
5. Print a second time and verify printing does not create a second sale/payment/stock movement.
6. Test a long receipt.
7. Test Nepali/English text actually used in operations.
8. Power-cycle the printer and repeat.

Record printer model, paper width, browser, operating system, date and result.

## Release status

Mark each hardware path as:

- VERIFIED PASS
- FAILED
- BLOCKED
- NOT TESTED

Do not mark Pasalho Lite hardware-ready until the real launch devices pass.
