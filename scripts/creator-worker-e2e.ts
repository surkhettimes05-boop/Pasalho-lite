import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

async function main() {
  const db = new URL(process.env.DATABASE_URL || "");
  const endpoint = new URL(process.env.CREATOR_ATTRIBUTION_API_URL || "");
  assert.equal(process.env.APP_ENV, "test");
  assert.ok(["127.0.0.1", "localhost"].includes(db.hostname));
  assert.match(db.pathname, /^\/pasalho_creator_test_[a-f0-9]+$/);
  assert.equal(endpoint.hostname, "127.0.0.1");
  assert.equal(endpoint.protocol, "http:");
  assert.ok(process.env.CREATOR_ATTRIBUTION_HMAC_SECRET);
  const payload = JSON.parse(process.env.CREATOR_TEST_PAYLOAD || "");
  const expected = Number(process.env.CREATOR_TEST_EXPECT_HTTP || "200");
  assert.ok(["POS_SALE_COMPLETED", "POS_SALE_RETURNED"].includes(payload.eventType));
  const { prisma } = await import("../src/lib/db");
  const { dispatchCreatorAttributionOutbox } = await import("../src/modules/creator-attribution/outbox.service");
  try {
    const key = (payload.eventType === "POS_SALE_RETURNED" ? "pos-return:" : "pos-sale:") + payload.sourceTransactionId;
    const row = await prisma.creatorAttributionOutbox.upsert({
      where: { eventKey: key },
      create: { id: randomUUID(), eventKey: key, payload },
      update: { status: "PENDING", nextAttemptAt: new Date() },
    });
    const result = await dispatchCreatorAttributionOutbox();
    const after = await prisma.creatorAttributionOutbox.findUniqueOrThrow({where:{id:row.id}});
    assert.equal(result.configured, true);
    if (expected === 200) {
      assert.equal(after.status, "SENT");
      assert.equal(after.lastErrorCode, null);
    } else {
      assert.equal(after.status, "PENDING");
      assert.equal(after.lastErrorCode, "UPSTREAM_HTTP_" + expected);
      assert.ok(after.attemptCount > row.attemptCount);
      assert.ok(after.nextAttemptAt > new Date());
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
