import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CashMovementEffect,
  CashMovementType,
  Role,
} from "@/generated/prisma/client";
import { AuthorizationError } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import { recordCashMovement } from "@/modules/cash/cash.service";

const suffix = randomUUID().slice(0, 8);
const operatingDate = "2026-09-10";

let owner: SessionUser;
let cashier: SessionUser;
let warehouse: SessionUser;
let openingId: string;

beforeAll(async () => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.SEED_OWNER_EMAIL!.toLowerCase() },
  });

  owner = { id: user.id, name: user.name, email: user.email, role: user.role };
  cashier = { ...owner, role: Role.CASHIER_STORE };
  warehouse = { ...owner, role: Role.WAREHOUSE_STAFF };
});

describe("Phase 8 cash movement ledger", () => {
  it("records opening cash once and replays the same command safely", async () => {
    const key = `p8-ledger-opening-${suffix}`;
    const input = {
      operatingDate,
      type: CashMovementType.OPENING_CASH,
      effect: null,
      amount: "3000.00",
      category: "OPENING_DRAWER",
      reason: "Opening drawer cash",
      idempotencyKey: key,
    };

    const first = await recordCashMovement(cashier, input);
    openingId = first.id;

    expect(first.effect).toBe(CashMovementEffect.IN);
    expect(first.amount.toFixed(2)).toBe("3000.00");

    const replay = await recordCashMovement(cashier, input);
    expect(replay.id).toBe(first.id);

    expect(
      await prisma.cashMovement.count({
        where: { idempotencyKey: key },
      }),
    ).toBe(1);
  });

  it("rejects a second opening cash for the same operating day", async () => {
    await expect(
      recordCashMovement(owner, {
        operatingDate,
        type: CashMovementType.OPENING_CASH,
        effect: null,
        amount: "1000.00",
        category: "OPENING_DRAWER",
        reason: "Duplicate opening",
        idempotencyKey: `p8-ledger-opening-duplicate-${suffix}`,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "OPENING_CASH_ALREADY_EXISTS",
    });
  });

  it("derives standard directions and requires direction for OTHER_APPROVED", async () => {
    const expense = await recordCashMovement(cashier, {
      operatingDate,
      type: CashMovementType.EXPENSE,
      effect: CashMovementEffect.IN,
      amount: "250.00",
      category: "TEA",
      reason: "Staff tea",
      idempotencyKey: `p8-ledger-expense-${suffix}`,
    });

    expect(expense.effect).toBe(CashMovementEffect.OUT);

    const cashAdded = await recordCashMovement(owner, {
      operatingDate,
      type: CashMovementType.CASH_ADDED,
      effect: CashMovementEffect.OUT,
      amount: "500.00",
      category: "TOP_UP",
      reason: "Owner added drawer cash",
      idempotencyKey: `p8-ledger-added-${suffix}`,
    });

    expect(cashAdded.effect).toBe(CashMovementEffect.IN);

    await expect(
      recordCashMovement(owner, {
        operatingDate,
        type: CashMovementType.OTHER_APPROVED,
        effect: null,
        amount: "100.00",
        category: "OTHER",
        reason: "Direction intentionally missing",
        idempotencyKey: `p8-ledger-other-missing-${suffix}`,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "CASH_EFFECT_REQUIRED",
    });

    const otherOut = await recordCashMovement(owner, {
      operatingDate,
      type: CashMovementType.OTHER_APPROVED,
      effect: CashMovementEffect.OUT,
      amount: "100.00",
      category: "OTHER",
      reason: "Approved drawer correction outflow",
      idempotencyKey: `p8-ledger-other-out-${suffix}`,
    });

    expect(otherOut.effect).toBe(CashMovementEffect.OUT);
  });

  it("blocks warehouse staff from recording store cash movements", async () => {
    await expect(
      recordCashMovement(warehouse, {
        operatingDate,
        type: CashMovementType.EXPENSE,
        effect: null,
        amount: "100.00",
        category: "UNAUTHORIZED",
        reason: "Warehouse should not control drawer",
        idempotencyKey: `p8-ledger-warehouse-${suffix}`,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("keeps cash movement evidence append-only in PostgreSQL", async () => {
    await expect(
      prisma.cashMovement.update({
        where: { id: openingId },
        data: { amount: "1.00" },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.cashMovement.delete({
        where: { id: openingId },
      }),
    ).rejects.toThrow();

    const original = await prisma.cashMovement.findUniqueOrThrow({
      where: { id: openingId },
    });
    expect(original.amount.toFixed(2)).toBe("3000.00");
  });
});
