import {
  CashMovementEffect,
  CashMovementType,
  DailyCloseStatus,
  LocationType,
  PaymentMethod,
  PaymentSourceType,
  Prisma,
  Role,
} from "@/generated/prisma/client";
import { assertRole } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import {
  getNepalOperatingDateKey,
  nepalOperatingDayBounds,
  parseOperatingDate,
} from "@/lib/time";
import {
  closeDailyInputSchema,
  reopenDailyCloseInputSchema,
  type CloseDailyInput,
  type ReopenDailyCloseInput,
} from "@/modules/daily-close/daily-close.schemas";

const dailyCloseInclude = {
  storeLocation: {
    select: {
      code: true,
      name: true,
    },
  },
  closedBy: {
    select: {
      name: true,
      email: true,
    },
  },
  reopenedBy: {
    select: {
      name: true,
      email: true,
    },
  },
} satisfies Prisma.DailyCloseInclude;

async function getStore(tx: Prisma.TransactionClient) {
  const store = await tx.location.findFirst({
    where: {
      code: "STORE_MAIN",
      type: LocationType.STORE,
      active: true,
    },
  });

  if (!store) {
    throw new BusinessError(
      "STORE_NOT_FOUND",
      "The V1 store is not available.",
    );
  }

  return store;
}

function sumAmounts(
  items: Array<{ amount: Prisma.Decimal }>,
) {
  return items.reduce(
    (sum, item) => sum.add(item.amount),
    new Prisma.Decimal(0),
  );
}

async function calculateSnapshot(
  tx: Prisma.TransactionClient,
  operatingDateKey: string,
  storeLocationId: string,
) {
  const operatingDate = parseOperatingDate(operatingDateKey);
  const { start, end } = nepalOperatingDayBounds(operatingDateKey);

  const [
    movements,
    cashPos,
    codCollected,
    qrSales,
    pendingCod,
  ] = await Promise.all([
    tx.cashMovement.findMany({
      where: {
        storeLocationId,
        operatingDate,
      },
      select: {
        type: true,
        effect: true,
        amount: true,
      },
    }),
    tx.payment.aggregate({
      where: {
        sourceType: PaymentSourceType.SALE,
        method: PaymentMethod.CASH,
        collectedAt: {
          gte: start,
          lt: end,
        },
      },
      _sum: { amount: true },
    }),
    tx.payment.aggregate({
      where: {
        sourceType: PaymentSourceType.CUSTOMER_ORDER,
        method: PaymentMethod.COD,
        collectedAt: {
          gte: start,
          lt: end,
        },
      },
      _sum: { amount: true },
    }),
    tx.payment.aggregate({
      where: {
        sourceType: PaymentSourceType.SALE,
        method: PaymentMethod.QR_NON_CASH,
        collectedAt: {
          gte: start,
          lt: end,
        },
      },
      _sum: { amount: true },
    }),
    tx.customerOrder.aggregate({
      where: {
        createdAt: { lt: end },
        paymentStatus: "PENDING",
        status: { not: "CANCELLED" },
      },
      _sum: { total: true },
    }),
  ]);

  const openingCash = sumAmounts(
    movements.filter(
      (movement) => movement.type === CashMovementType.OPENING_CASH,
    ),
  );

  const cashAdded = sumAmounts(
    movements.filter(
      (movement) =>
        movement.effect === CashMovementEffect.IN &&
        (movement.type === CashMovementType.CASH_ADDED ||
          movement.type === CashMovementType.OTHER_APPROVED),
    ),
  );

  const cashRefunds = sumAmounts(
    movements.filter(
      (movement) =>
        movement.type === CashMovementType.REFUND_OUT &&
        movement.effect === CashMovementEffect.OUT,
    ),
  );

  const cashExpenses = sumAmounts(
    movements.filter(
      (movement) =>
        movement.effect === CashMovementEffect.OUT &&
        (movement.type === CashMovementType.EXPENSE ||
          movement.type === CashMovementType.CASH_PAYOUT ||
          movement.type === CashMovementType.OTHER_APPROVED),
    ),
  );

  const cashPosSales = cashPos._sum.amount ?? new Prisma.Decimal(0);
  const codCashCollected =
    codCollected._sum.amount ?? new Prisma.Decimal(0);
  const qrNonCashSales = qrSales._sum.amount ?? new Prisma.Decimal(0);
  const pendingCodAmount =
    pendingCod._sum.total ?? new Prisma.Decimal(0);

  const expectedCash = openingCash
    .add(cashPosSales)
    .add(codCashCollected)
    .add(cashAdded)
    .sub(cashRefunds)
    .sub(cashExpenses);

  return {
    operatingDate,
    openingCash,
    cashPosSales,
    codCashCollected,
    cashAdded,
    cashRefunds,
    cashExpenses,
    expectedCash,
    qrNonCashSales,
    pendingCodAmount,
  };
}

function ensureDateNotFuture(key: string) {
  if (key > getNepalOperatingDateKey()) {
    throw new BusinessError(
      "FUTURE_OPERATING_DATE",
      "A future operating day cannot be closed.",
    );
  }
}

export async function getDailyClosePreview(operatingDateKey: string) {
  ensureDateNotFuture(operatingDateKey);

  return prisma.$transaction(async (tx) => {
    const store = await getStore(tx);
    const snapshot = await calculateSnapshot(tx, operatingDateKey, store.id);
    const activeClose = await tx.dailyClose.findFirst({
      where: {
        storeLocationId: store.id,
        operatingDate: snapshot.operatingDate,
        status: DailyCloseStatus.CLOSED,
      },
      include: dailyCloseInclude,
    });

    return { snapshot, activeClose, store };
  });
}

export async function closeOperatingDay(
  actor: SessionUser,
  input: CloseDailyInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsed = closeDailyInputSchema.parse(input);
  ensureDateNotFuture(parsed.operatingDate);

  const operatingDate = parseOperatingDate(parsed.operatingDate);
  const actualCash = new Prisma.Decimal(parsed.actualCash);

  const replay = await prisma.dailyClose.findUnique({
    where: { closeIdempotencyKey: parsed.idempotencyKey },
    include: dailyCloseInclude,
  });

  if (replay) {
    const same =
      replay.operatingDate.getTime() === operatingDate.getTime() &&
      replay.actualCash.equals(actualCash) &&
      replay.notes === parsed.notes;

    if (!same) {
      throw new BusinessError(
        "IDEMPOTENCY_CONFLICT",
        "That daily-close idempotency key was already used differently.",
      );
    }

    return replay;
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        const store = await getStore(tx);

        const alreadyClosed = await tx.dailyClose.findFirst({
          where: {
            storeLocationId: store.id,
            operatingDate,
            status: DailyCloseStatus.CLOSED,
          },
        });

        if (alreadyClosed) {
          throw new BusinessError(
            "DAILY_CLOSE_ALREADY_EXISTS",
            "This operating day already has an active CLOSED record.",
          );
        }

        const snapshot = await calculateSnapshot(
          tx,
          parsed.operatingDate,
          store.id,
        );
        const variance = actualCash.sub(snapshot.expectedCash);

        if (!variance.isZero() && !parsed.notes) {
          throw new BusinessError(
            "VARIANCE_NOTE_REQUIRED",
            "A non-zero cash variance requires a note.",
          );
        }

        const now = new Date();
        const close = await tx.dailyClose.create({
          data: {
            storeLocationId: store.id,
            operatingDate,
            openingCash: snapshot.openingCash,
            cashPosSales: snapshot.cashPosSales,
            codCashCollected: snapshot.codCashCollected,
            cashAdded: snapshot.cashAdded,
            cashRefunds: snapshot.cashRefunds,
            cashExpenses: snapshot.cashExpenses,
            expectedCash: snapshot.expectedCash,
            actualCash,
            variance,
            qrNonCashSales: snapshot.qrNonCashSales,
            pendingCodAmount: snapshot.pendingCodAmount,
            notes: parsed.notes,
            status: DailyCloseStatus.CLOSED,
            closeIdempotencyKey: parsed.idempotencyKey,
            closedByUserId: actor.id,
            closedAt: now,
          },
          include: dailyCloseInclude,
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: "DAILY_CLOSE_COMPLETED",
            entityType: "DailyClose",
            entityId: close.id,
            afterData: {
              operatingDate: parsed.operatingDate,
              expectedCash: close.expectedCash.toFixed(2),
              actualCash: close.actualCash.toFixed(2),
              variance: close.variance.toFixed(2),
            },
          },
        });

        return close;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const replayAfterConflict = await prisma.dailyClose.findUnique({
        where: { closeIdempotencyKey: parsed.idempotencyKey },
        include: dailyCloseInclude,
      });

      if (replayAfterConflict) return replayAfterConflict;

      throw new BusinessError(
        "DAILY_CLOSE_ALREADY_EXISTS",
        "This operating day already has an active CLOSED record.",
      );
    }

    throw error;
  }
}

export async function reopenDailyClose(
  actor: SessionUser,
  input: ReopenDailyCloseInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const parsed = reopenDailyCloseInputSchema.parse(input);

  const replay = await prisma.dailyClose.findUnique({
    where: { reopenIdempotencyKey: parsed.idempotencyKey },
    include: dailyCloseInclude,
  });

  if (replay) return replay;

  return prisma.$transaction(
    async (tx) => {
      const close = await tx.dailyClose.findUnique({
        where: { id: parsed.closeId },
        include: dailyCloseInclude,
      });

      if (!close) {
        throw new BusinessError(
          "DAILY_CLOSE_NOT_FOUND",
          "Daily close was not found.",
        );
      }

      if (close.status !== DailyCloseStatus.CLOSED) {
        throw new BusinessError(
          "DAILY_CLOSE_ALREADY_REOPENED",
          "This daily close has already been reopened.",
        );
      }

      const now = new Date();
      const reopened = await tx.dailyClose.update({
        where: { id: close.id },
        data: {
          status: DailyCloseStatus.REOPENED,
          reopenIdempotencyKey: parsed.idempotencyKey,
          reopenedByUserId: actor.id,
          reopenedAt: now,
        },
        include: dailyCloseInclude,
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "DAILY_CLOSE_REOPENED",
          entityType: "DailyClose",
          entityId: close.id,
          beforeData: {
            status: close.status,
            operatingDate: close.operatingDate.toISOString().slice(0, 10),
            expectedCash: close.expectedCash.toFixed(2),
            actualCash: close.actualCash.toFixed(2),
            variance: close.variance.toFixed(2),
          },
          afterData: {
            status: reopened.status,
            reopenedAt: now.toISOString(),
            reason: parsed.reason,
          },
        },
      });

      return reopened;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function getDailyCloseById(closeId: string) {
  return prisma.dailyClose.findUnique({
    where: { id: closeId },
    include: dailyCloseInclude,
  });
}

export async function getDailyClosePage(page = 1, pageSize = 30) {
  const normalizedPage = Math.max(1, page);
  const normalizedPageSize = Math.min(Math.max(pageSize, 1), 100);

  const [closes, total] = await Promise.all([
    prisma.dailyClose.findMany({
      orderBy: [{ operatingDate: "desc" }, { closedAt: "desc" }],
      skip: (normalizedPage - 1) * normalizedPageSize,
      take: normalizedPageSize,
      include: dailyCloseInclude,
    }),
    prisma.dailyClose.count(),
  ]);

  return {
    closes,
    total,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
  };
}
