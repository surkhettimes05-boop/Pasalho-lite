import pg from "pg";

const { Client } = pg;

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const restoreUrl = process.env.RESTORE_DATABASE_URL;

if (!sourceUrl || !restoreUrl) {
  throw new Error("SOURCE_DATABASE_URL and RESTORE_DATABASE_URL are required.");
}

const tables = [
  "User",
  "Location",
  "Product",
  "StockBalance",
  "InventoryMovement",
  "PurchaseReceipt",
  "Transfer",
  "Customer",
  "LoyaltyAccount",
  "LoyaltyTransaction",
  "Sale",
  "Payment",
  "CustomerOrder",
  "InventoryReservation",
  "Return",
  "CashMovement",
  "DailyClose",
  "AuditLog",
];

async function snapshot(connectionString: string) {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const counts: Record<string, number> = {};

    for (const table of tables) {
      const result = await client.query(
        `SELECT COUNT(*)::int AS count FROM "${table}"`,
      );
      counts[table] = Number(result.rows[0].count);
    }

    const integrity = await client.query(`
      SELECT
        COALESCE((SELECT SUM("onHand") FROM "StockBalance"), 0)::text AS stock_on_hand,
        COALESCE((SELECT SUM("reserved") FROM "StockBalance"), 0)::text AS stock_reserved,
        COALESCE((SELECT SUM("amount") FROM "Payment"), 0)::text AS payment_amount,
        COALESCE((SELECT SUM("refundedAmount") FROM "Payment"), 0)::text AS payment_refunded,
        COALESCE((SELECT SUM("pointBalance") FROM "LoyaltyAccount"), 0)::text AS loyalty_points,
        COALESCE((SELECT SUM("expectedCash") FROM "DailyClose"), 0)::text AS close_expected
    `);

    return { counts, integrity: integrity.rows[0] };
  } finally {
    await client.end();
  }
}

const source = await snapshot(sourceUrl);
const restored = await snapshot(restoreUrl);

if (JSON.stringify(source) !== JSON.stringify(restored)) {
  console.error("Source snapshot:", source);
  console.error("Restored snapshot:", restored);
  throw new Error("Backup restore verification failed.");
}

console.log(
  JSON.stringify({
    status: "ok",
    tablesVerified: tables.length,
    source,
  }),
);
