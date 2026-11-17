import { prisma } from "@/lib/db";

type OutboxPayload = Record<string, unknown>;

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function signBody(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return bytesToHex(signature);
}

/**
 * Best-effort delivery. The durable outbox is committed with the POS sale;
 * network failures never change the already-finalized sale outcome.
 */
export async function dispatchCreatorAttributionOutbox(limit = 20) {
  const endpoint = process.env.CREATOR_ATTRIBUTION_API_URL;
  const secret = process.env.CREATOR_ATTRIBUTION_HMAC_SECRET;

  if (!endpoint || !secret) {
    return { sent: 0, pending: 0, configured: false };
  }

  const due = await prisma.creatorAttributionOutbox.findMany({
    where: {
      status: "PENDING",
      nextAttemptAt: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 50),
  });

  let sent = 0;
  for (const event of due) {
    const payload = event.payload as OutboxPayload;
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const targetEndpoint = payload.eventType === "POS_SALE_RETURNED"
      ? endpoint.replace(/\/pos-sales\/?$/, "/pos-returns")
      : endpoint;

    try {
      const signature = await signBody(secret, timestamp, body);
      const response = await fetch(targetEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pasalho-timestamp": timestamp,
          "x-pasalho-signature": signature,
          "x-pasalho-event-key": event.eventKey,
        },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        throw new Error(`UPSTREAM_HTTP_${response.status}`);
      }

      await prisma.creatorAttributionOutbox.update({
        where: { id: event.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          lastErrorCode: null,
        },
      });
      sent += 1;
    } catch (error) {
      const attemptCount = event.attemptCount + 1;
      const delaySeconds = Math.min(60 * 2 ** Math.min(attemptCount, 10), 21600);
      const errorCode =
        error instanceof Error && /^UPSTREAM_HTTP_\d+$/.test(error.message)
          ? error.message
          : "DELIVERY_FAILED";

      await prisma.creatorAttributionOutbox.update({
        where: { id: event.id },
        data: {
          attemptCount,
          nextAttemptAt: new Date(Date.now() + delaySeconds * 1000),
          lastErrorCode: errorCode,
        },
      });
    }
  }

  return {
    sent,
    pending: due.length - sent,
    configured: true,
  };
}
