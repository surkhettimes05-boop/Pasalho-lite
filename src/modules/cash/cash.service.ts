import {
  CashMovementEffect,
  CashMovementType,
  DailyCloseStatus,
  LocationType,
  Prisma,
  Role,
} from "@/generated/prisma/client";
import { assertRole } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import {
  getNepalOperatingDateKey,
  parseOperatingDate,
} from "@/lib/time";
import {
  cashMovementInputSchema,
  type CashMovementInput,
} from "@/modules/cash/cash.schemas";

const cashMovementInclude = {
  user: {
    select: {
      name: true,
      email: true,
    },
  },
  storeLocation: {
    select: {
      code: true,
      name: true,
    },
  },
} satisfies Prisma.CashMovementInclude;

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

function manualEffect(
  type: CashMovementInput["type"],
  requested?: CashMovementEffect | null,
) {
  if (
    type === CashMovementType.OPENING_CASH ||
    type === CashMovementType.CASH_ADDED
  ) {
    return CashMovementEffect.IN;
  }

  if (
    type === CashMovementType.EXPENSE ||
    type === CashMovementType.CASH_PAYOUT
  ) {
    return CashMovementEffect.OUT;
  }

  if (!requested) {
    throw new BusinessError(
      "CASH_EFFECT_REQUIRED",
      "OTHER_APPROVED cash movement must specify whether cash came in or went out.",
    );
  }

  return requested;
}

async function assertOperatingDayOpen(
  tx: Prisma.TransactionClient,
  storeLocationId: string,
  operatingDate: Date,
) {
  const closed = await tx.dailyClose.findFirst({
    where: {
      storeLocationId,
      operatingDate,
      status: DailyCloseStatus.CLOSED,
    },
    select: { id: true },
  });

  if (closed) {
    throw new BusinessError(
      "CASH_DAY_CLOSED",
      "This operating day is closed. Owner/Admin must reopen it before recording more cash activity.",
    );
  }
}

function assertNotFutureOperatingDate(operatingDateKey: string) {
  if (operatingDateKey > getNepalOperatingDateKey()) {
    throw new BusinessError(
      "FUTURE_OPERATING_DATE",
      "Cash activity cannot be recorded for a future operating date.",
    );
  }
}

export async function recordCashMovement(
  actor: SessionUser,
  input: CashMovementInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsed = cashMovementInputSchema.parse(input);
  assertNotFutureOperatingDate(parsed.operatingDate);

  const operatingDate = parseOperatingDate(parsed.operatingDate);
  const amount = new Prisma.Decimal(parsed.amount);
  const effect = manualEffect(parsed.type, parsed.effect);

  const replay = await prisma.cashMovement.findUnique({
    where: { idempotencyKey: parsed.idempotencyKey },
    include: cashMovementInclude,
  });

  if (replay) {
    const same =
      replay.operatingDate.getTime() === operatingDate.getTime() &&
      replay.type === parsed.type &&
      replay.effect === effect &&
      replay.amount.equals(amount) &&
      replay.category === parsed.category &&
      replay.reason === parsed.reason;

    if (!same) {
      throw new BusinessError(
        "IDEMPOTENCY_CONFLICT",
        "That cash movement idempotency key was already used differently.",
      );
    }

    return replay;
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        const store = await getStore(tx);
        await assertOperatingDayOpen(tx, store.id, operatingDate);

        const movement = await tx.cashMovement.create({
          data: {
            storeLocationId: store.id,
            operatingDate,
            type: parsed.type,
            effect,
            amount,
            category: parsed.category,
            reason: parsed.reason,
            referenceType: null,
            referenceId: null,
            idempotencyKey: parsed.idempotencyKey,
            userId: actor.id,
          },
          include: cashMovementInclude,
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: "CASH_MOVEMENT_RECORDED",
            entityType: "CashMovement",
            entityId: movement.id,
            afterData: {
              operatingDate: parsed.operatingDate,
              type: movement.type,
              effect: movement.effect,
              amount: movement.amount.toFixed(2),
              category: movement.category,
              reason: movement.reason,
            },
          },
        });

        return movement;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const replayAfterConflict = await prisma.cashMovement.findUnique({
        where: { idempotencyKey: parsed.idempotencyKey },
        include: cashMovementInclude,
      });

      if (replayAfterConflict) return replayAfterConflict;

      if (parsed.type === CashMovementType.OPENING_CASH) {
        throw new BusinessError(
          "OPENING_CASH_ALREADY_EXISTS",
          "Opening cash is already recorded for this operating day.",
        );
      }
    }

    throw error;
  }
}

export async function recordSystemRefundCashMovement(
  tx: Prisma.TransactionClient,
  input: {
    storeLocationId: string;
    operatingDateKey: string;
    amount: Prisma.Decimal;
    reason: string;
    referenceId: string;
    idempotencyKey: string;
    actorUserId: string;
  },
) {
  if (!input.amount.greaterThan(0)) {
    throw new BusinessError(
      "INVALID_CASH_MOVEMENT_AMOUNT",
      "Refund cash movement must be greater than zero.",
    );
  }

  const operatingDate = parseOperatingDate(input.operatingDateKey);
  await assertOperatingDayOpen(tx, input.storeLocationId, operatingDate);

  const existing = await tx.cashMovement.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });

  if (existing) {
    const same =
      existing.storeLocationId === input.storeLocationId &&
      existing.operatingDate.getTime() === operatingDate.getTime() &&
      existing.type === CashMovementType.REFUND_OUT &&
      existing.effect === CashMovementEffect.OUT &&
      existing.amount.equals(input.amount) &&
      existing.referenceType === "RETURN" &&
      existing.referenceId === input.referenceId;

    if (!same) {
      throw new BusinessError(
        "IDEMPOTENCY_CONFLICT",
        "Refund cash movement idempotency key conflicts with an earlier movement.",
      );
    }

    return existing;
  }

  return tx.cashMovement.create({
    data: {
      storeLocationId: input.storeLocationId,
      operatingDate,
      type: CashMovementType.REFUND_OUT,
      effect: CashMovementEffect.OUT,
      amount: input.amount,
      category: "RETURN_REFUND",
      reason: input.reason,
      referenceType: "RETURN",
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      userId: input.actorUserId,
    },
  });
}

export async function getCashMovementPage({
  operatingDate,
  page = 1,
  pageSize = 40,
}: {
  operatingDate?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const normalizedPage = Math.max(1, page);
  const normalizedPageSize = Math.min(Math.max(pageSize, 1), 100);
  const date = operatingDate ? parseOperatingDate(operatingDate) : undefined;

  const where: Prisma.CashMovementWhereInput = date
    ? { operatingDate: date }
    : {};

  const [movements, total] = await Promise.all([
    prisma.cashMovement.findMany({
      where,
      orderBy: [{ operatingDate: "desc" }, { createdAt: "desc" }],
      skip: (normalizedPage - 1) * normalizedPageSize,
      take: normalizedPageSize,
      include: cashMovementInclude,
    }),
    prisma.cashMovement.count({ where }),
  ]);

  return {
    movements,
    total,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
  };
}
