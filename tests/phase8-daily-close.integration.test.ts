import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CashMovementEffect,
  CashMovementType,
  CustomerOrderStatus,
  DailyCloseStatus,
  PaymentMethod,
  PaymentSourceType,
  PaymentStatus,
  Role,
} from "@/generated/prisma/client";
import { AuthorizationError } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import { nepalOperatingDayBounds, parseOperatingDate } from "@/lib/time";
import { recordCashMovement } from "@/modules/cash/cash.service";
import {
  closeOperatingDay,
  getDailyClosePreview,
  reopenDailyClose,
} from "@/modules/daily-close/daily-close.service";
import { createCustomer } from "@/modules/customers/customer.service";

const suffix = randomUUID().slice(0, 8);
const digits = suffix.replace(/\D/g, "").padEnd(8, "4").slice(0, 8);
const operatingDate = "2026-09-11";

let owner: SessionUser;
let cashier: SessionUser;
let warehouse: SessionUser;
let storeId: string;
let customerId: string;
let closeId: string;
let closeKey: string;

beforeAll(async () => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.SEED_OWNER_EMAIL!.toLowerCase() },
  });

  owner = { id: user.id, name: user.name, email: user.email, role: user.role };
  cashier = { ...owner, role: Role.CASHIER_STORE };
  warehouse = { ...owner, role: Role.WAREHOUSE_STAFF };

  storeId = (
    await prisma.location.findUniqueOrThrow({ where: { code: "STORE_MAIN" } })
  ).id;

  customerId = (
    await createCustomer(cashier, {
      phone: `95${digits}`,
      name: "Phase 8 Daily Close Customer",
      notes: "",
    })
  ).id;

  await recordCashMovement(cashier, {
    operatingDate,
    type: CashMovementType.OPENING_CASH,
    effect: null,
    amount: "5000.00",
    category: "OPENING_DRAWER",
    reason: "Phase 8 canonical opening cash",
    idempotencyKey: `p8-open-${suffix}`,
  });

  await recordCashMovement(cashier, {
    operatingDate,
    type: CashMovementType.EXPENSE,
    effect: null,
    amount: "2500.00",
    category: "OPERATING_EXPENSE",
    reason: "Phase 8 canonical cash expense",
    idempotencyKey: `p8-expense-${suffix}`,
  });

  const { start } = nepalOperatingDayBounds(operatingDate);
  const collectedAt = new Date(start.getTime() + 3 * 60 * 60 * 1000);

  await prisma.payment.createMany({
    data: [
      {
        sourceType: PaymentSourceType.SALE,
        sourceId: randomUUID(),
        method: PaymentMethod.CASH,
        status: PaymentStatus.PAID,
        amount: "37500.00",
        collectedAt,
        refundedAmount: "0",
        idempotencyKey: `p8-cash-sale-${suffix}`,
        recordedByUserId: owner.id,
      },
      {
        sourceType: PaymentSourceType.CUSTOMER_ORDER,
        sourceId: randomUUID(),
        method: PaymentMethod.COD,
        status: PaymentStatus.PAID,
        amount: "8000.00",
        collectedAt,
        refundedAmount: "0",
        idempotencyKey: `p8-cod-collected-${suffix}`,
        recordedByUserId: owner.id,
      },
      {
        sourceType: PaymentSourceType.SALE,
        sourceId: randomUUID(),
        method: PaymentMethod.QR_NON_CASH,
        status: PaymentStatus.PAID,
        amount: "4200.00",
        collectedAt,
        refundedAmount: "0",
        idempotencyKey: `p8-qr-sale-${suffix}`,
        recordedByUserId: owner.id,
      },
    ],
  });

  await prisma.customerOrder.create({
    data: {
      orderNumber: `P8-PENDING-${suffix}`,
      customerId,
      storeLocationId: storeId,
      status: CustomerOrderStatus.NEW,
      phoneSnapshot: `95${digits}`,
      addressText: "Phase 8 pending COD",
      subtotal: "900.00",
      discountTotal: "0",
      deliveryCharge: "0",
      total: "900.00",
      paymentMethod: PaymentMethod.COD,
      paymentStatus: PaymentStatus.PENDING,
      notes: null,
      createdByUserId: owner.id,
      createIdempotencyKey: `p8-pending-order-${suffix}`,
      createdAt: collectedAt,
    },
  });
});

describe("Phase 8 canonical daily close", () => {
  it("computes the locked expected-cash equation server-side", async () => {
    const preview = await getDailyClosePreview(operatingDate);
    const s = preview.snapshot;

    expect(s.openingCash.toFixed(2)).toBe("5000.00");
    expect(s.cashPosSales.toFixed(2)).toBe("37500.00");
    expect(s.codCashCollected.toFixed(2)).toBe("8000.00");
    expect(s.cashAdded.toFixed(2)).toBe("0.00");
    expect(s.cashRefunds.toFixed(2)).toBe("0.00");
    expect(s.cashExpenses.toFixed(2)).toBe("2500.00");
    expect(s.expectedCash.toFixed(2)).toBe("48000.00");

    expect(s.qrNonCashSales.toFixed(2)).toBe("4200.00");
    expect(s.pendingCodAmount.toFixed(2)).toBe("900.00");
  });

  it("persists actual cash 47,850 with variance -150 and requires a note", async () => {
    await expect(
      closeOperatingDay(cashier, {
        operatingDate,
        actualCash: "47850.00",
        notes: "",
        idempotencyKey: `p8-close-no-note-${suffix}`,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "VARIANCE_NOTE_REQUIRED",
    });

    closeKey = `p8-close-${suffix}`;
    const close = await closeOperatingDay(cashier, {
      operatingDate,
      actualCash: "47850.00",
      notes: "Rs 150 drawer shortage investigated at close",
      idempotencyKey: closeKey,
    });

    closeId = close.id;

    expect(close.status).toBe(DailyCloseStatus.CLOSED);
    expect(close.expectedCash.toFixed(2)).toBe("48000.00");
    expect(close.actualCash.toFixed(2)).toBe("47850.00");
    expect(close.variance.toFixed(2)).toBe("-150.00");
  });

  it("replays the same close without a duplicate and rejects a second active close", async () => {
    const replay = await closeOperatingDay(cashier, {
      operatingDate,
      actualCash: "47850.00",
      notes: "Rs 150 drawer shortage investigated at close",
      idempotencyKey: closeKey,
    });

    expect(replay.id).toBe(closeId);

    expect(
      await prisma.dailyClose.count({
        where: {
          storeLocationId: storeId,
          operatingDate: parseOperatingDate(operatingDate),
          status: DailyCloseStatus.CLOSED,
        },
      }),
    ).toBe(1);

    await expect(
      closeOperatingDay(owner, {
        operatingDate,
        actualCash: "48000.00",
        notes: "",
        idempotencyKey: `p8-close-duplicate-${suffix}`,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "DAILY_CLOSE_ALREADY_EXISTS",
    });
  });

  it("blocks new cash movement while the day is closed", async () => {
    await expect(
      recordCashMovement(cashier, {
        operatingDate,
        type: CashMovementType.CASH_ADDED,
        effect: null,
        amount: "1000.00",
        category: "PETTY_CASH_TOPUP",
        reason: "Should be blocked while closed",
        idempotencyKey: `p8-closed-movement-${suffix}`,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "CASH_DAY_CLOSED",
    });
  });

  it("denies cashier reopen, permits Owner/Admin reopen, and audits it", async () => {
    await expect(
      reopenDailyClose(cashier, {
        closeId,
        reason: "Cashier should not reopen",
        idempotencyKey: `p8-reopen-cashier-${suffix}`,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const reopened = await reopenDailyClose(owner, {
      closeId,
      reason: "Owner correcting missing cash activity",
      idempotencyKey: `p8-reopen-owner-${suffix}`,
    });

    expect(reopened.status).toBe(DailyCloseStatus.REOPENED);
    expect(reopened.reopenedByUserId).toBe(owner.id);
    expect(reopened.reopenedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "DAILY_CLOSE_REOPENED",
        entityType: "DailyClose",
        entityId: closeId,
      },
    });
    expect(audit.actorUserId).toBe(owner.id);
  });

  it("allows activity after reopen and creates a new CLOSED snapshot without rewriting the original", async () => {
    await recordCashMovement(cashier, {
      operatingDate,
      type: CashMovementType.CASH_ADDED,
      effect: null,
      amount: "1000.00",
      category: "MISSED_CASH_IN",
      reason: "Cash received earlier but omitted before first close",
      idempotencyKey: `p8-after-reopen-${suffix}`,
    });

    const preview = await getDailyClosePreview(operatingDate);
    expect(preview.activeClose).toBeNull();
    expect(preview.snapshot.expectedCash.toFixed(2)).toBe("49000.00");

    const secondClose = await closeOperatingDay(owner, {
      operatingDate,
      actualCash: "49000.00",
      notes: "",
      idempotencyKey: `p8-reclose-${suffix}`,
    });

    expect(secondClose.id).not.toBe(closeId);
    expect(secondClose.status).toBe(DailyCloseStatus.CLOSED);
    expect(secondClose.expectedCash.toFixed(2)).toBe("49000.00");
    expect(secondClose.variance.toFixed(2)).toBe("0.00");

    const original = await prisma.dailyClose.findUniqueOrThrow({
      where: { id: closeId },
    });
    expect(original.status).toBe(DailyCloseStatus.REOPENED);
    expect(original.expectedCash.toFixed(2)).toBe("48000.00");
    expect(original.actualCash.toFixed(2)).toBe("47850.00");
    expect(original.variance.toFixed(2)).toBe("-150.00");
  });
});
