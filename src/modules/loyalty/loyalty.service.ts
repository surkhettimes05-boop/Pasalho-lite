import {
  LoyaltySourceType,
  LoyaltyTransactionType,
  Prisma,
} from "@/generated/prisma/client";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";

export const LOYALTY_THRESHOLD = new Prisma.Decimal(500);

function projectionFromEligibleSpend(eligibleSpend: Prisma.Decimal) {
  if (eligibleSpend.isNegative()) {
    throw new BusinessError(
      "LOYALTY_NEGATIVE_SPEND",
      "Loyalty eligible spend cannot become negative.",
    );
  }

  const pointBalance = eligibleSpend
    .div(LOYALTY_THRESHOLD)
    .floor()
    .toNumber();
  const spendRemainder = eligibleSpend.mod(LOYALTY_THRESHOLD);

  return {
    pointBalance,
    spendRemainder,
  };
}

async function getEligibleSpendLedgerTotal(
  tx: Prisma.TransactionClient,
  customerId: string,
) {
  const aggregate = await tx.loyaltyTransaction.aggregate({
    where: { customerId },
    _sum: {
      eligibleSpendDelta: true,
    },
  });

  return aggregate._sum.eligibleSpendDelta ?? new Prisma.Decimal(0);
}

export async function applyEligibleSpend(
  tx: Prisma.TransactionClient,
  input: {
    customerId: string;
    eligibleSpend: Prisma.Decimal;
    sourceType: LoyaltySourceType;
    sourceId: string;
    idempotencyKey: string;
    actorUserId?: string | null;
    reason?: string | null;
  },
) {
  if (!input.eligibleSpend.greaterThan(0)) {
    throw new BusinessError(
      "INVALID_LOYALTY_SPEND",
      "Eligible spend must be greater than zero.",
    );
  }

  const existing = await tx.loyaltyTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });

  if (existing) {
    const sameCommand =
      existing.customerId === input.customerId &&
      existing.type === LoyaltyTransactionType.EARN &&
      existing.sourceType === input.sourceType &&
      existing.sourceId === input.sourceId &&
      existing.eligibleSpendDelta.equals(input.eligibleSpend);

    if (!sameCommand) {
      throw new BusinessError(
        "IDEMPOTENCY_CONFLICT",
        "That loyalty idempotency key was already used differently.",
      );
    }

    return existing;
  }

  const account = await tx.loyaltyAccount.upsert({
    where: { customerId: input.customerId },
    create: {
      customerId: input.customerId,
      pointBalance: 0,
      spendRemainder: new Prisma.Decimal(0),
    },
    update: {},
  });

  const beforeEligible = await getEligibleSpendLedgerTotal(
    tx,
    input.customerId,
  );
  const afterEligible = beforeEligible.add(input.eligibleSpend);
  const beforeProjection = projectionFromEligibleSpend(beforeEligible);
  const afterProjection = projectionFromEligibleSpend(afterEligible);
  const pointsDelta =
    afterProjection.pointBalance - beforeProjection.pointBalance;
  const nextPointBalance = account.pointBalance + pointsDelta;

  const loyaltyTransaction = await tx.loyaltyTransaction.create({
    data: {
      customerId: input.customerId,
      type: LoyaltyTransactionType.EARN,
      pointsDelta,
      eligibleSpendDelta: input.eligibleSpend,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason ?? null,
      actorUserId: input.actorUserId ?? null,
    },
  });

  await tx.loyaltyAccount.update({
    where: { customerId: input.customerId },
    data: {
      pointBalance: nextPointBalance,
      spendRemainder: afterProjection.spendRemainder,
    },
  });

  return loyaltyTransaction;
}

export async function applyEligibleSpendReversal(
  tx: Prisma.TransactionClient,
  input: {
    customerId: string;
    amount: Prisma.Decimal;
    sourceType: LoyaltySourceType;
    sourceId: string;
    idempotencyKey: string;
    actorUserId?: string | null;
    reason: string;
  },
) {
  if (!input.amount.greaterThan(0)) {
    throw new BusinessError(
      "INVALID_LOYALTY_REVERSAL",
      "Loyalty reversal amount must be greater than zero.",
    );
  }

  const existing = await tx.loyaltyTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });

  if (existing) {
    const sameCommand =
      existing.customerId === input.customerId &&
      existing.type === LoyaltyTransactionType.REVERSAL &&
      existing.sourceType === input.sourceType &&
      existing.sourceId === input.sourceId &&
      existing.eligibleSpendDelta.equals(input.amount.negated());

    if (!sameCommand) {
      throw new BusinessError(
        "IDEMPOTENCY_CONFLICT",
        "That loyalty reversal key was already used differently.",
      );
    }

    return existing;
  }

  const sourceTransactions = await tx.loyaltyTransaction.findMany({
    where: {
      customerId: input.customerId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    },
    select: {
      eligibleSpendDelta: true,
    },
  });

  const sourceNetEligible = sourceTransactions.reduce(
    (sum, item) => sum.add(item.eligibleSpendDelta),
    new Prisma.Decimal(0),
  );

  if (sourceNetEligible.lessThan(input.amount)) {
    throw new BusinessError(
      "LOYALTY_REVERSAL_EXCEEDS_SOURCE",
      "Loyalty reversal exceeds remaining eligible spend for the source.",
    );
  }

  const account = await tx.loyaltyAccount.findUnique({
    where: { customerId: input.customerId },
  });

  if (!account) {
    throw new BusinessError(
      "LOYALTY_ACCOUNT_NOT_FOUND",
      "Customer loyalty account not found.",
    );
  }

  const beforeEligible = await getEligibleSpendLedgerTotal(
    tx,
    input.customerId,
  );
  const afterEligible = beforeEligible.sub(input.amount);
  const beforeProjection = projectionFromEligibleSpend(beforeEligible);
  const afterProjection = projectionFromEligibleSpend(afterEligible);
  const pointsDelta =
    afterProjection.pointBalance - beforeProjection.pointBalance;
  const nextPointBalance = account.pointBalance + pointsDelta;

  if (nextPointBalance < 0) {
    throw new BusinessError(
      "LOYALTY_NEGATIVE_POINTS",
      "Loyalty reversal would make the point balance negative.",
    );
  }

  const loyaltyTransaction = await tx.loyaltyTransaction.create({
    data: {
      customerId: input.customerId,
      type: LoyaltyTransactionType.REVERSAL,
      pointsDelta,
      eligibleSpendDelta: input.amount.negated(),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      actorUserId: input.actorUserId ?? null,
    },
  });

  await tx.loyaltyAccount.update({
    where: { customerId: input.customerId },
    data: {
      pointBalance: nextPointBalance,
      spendRemainder: afterProjection.spendRemainder,
    },
  });

  return loyaltyTransaction;
}

export async function reconcileLoyaltyAccount(customerId: string) {
  const [account, transactions] = await Promise.all([
    prisma.loyaltyAccount.findUnique({
      where: { customerId },
    }),
    prisma.loyaltyTransaction.findMany({
      where: { customerId },
      select: {
        pointsDelta: true,
        eligibleSpendDelta: true,
      },
    }),
  ]);

  if (!account) {
    throw new BusinessError(
      "LOYALTY_ACCOUNT_NOT_FOUND",
      "Customer loyalty account not found.",
    );
  }

  const ledgerPoints = transactions.reduce(
    (sum, item) => sum + item.pointsDelta,
    0,
  );
  const ledgerEligibleSpend = transactions.reduce(
    (sum, item) => sum.add(item.eligibleSpendDelta),
    new Prisma.Decimal(0),
  );
  const ledgerProjection = projectionFromEligibleSpend(ledgerEligibleSpend);

  return {
    matches:
      ledgerPoints === account.pointBalance &&
      ledgerProjection.pointBalance === account.pointBalance &&
      ledgerProjection.spendRemainder.equals(account.spendRemainder),
    accountPointBalance: account.pointBalance,
    ledgerPoints,
    accountSpendRemainder: account.spendRemainder,
    ledgerSpendRemainder: ledgerProjection.spendRemainder,
    ledgerEligibleSpend,
  };
}
