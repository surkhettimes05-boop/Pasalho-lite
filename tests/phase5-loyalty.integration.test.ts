import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  LoyaltySourceType,
  LoyaltyTransactionType,
  PaymentMethod,
  Prisma,
  Role,
} from "@/generated/prisma/client";
import { AuthorizationError } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import {
  createCustomer,
  findCustomerByPhone,
  normalizeCustomerPhone,
} from "@/modules/customers/customer.service";
import {
  applyEligibleSpendReversal,
  reconcileLoyaltyAccount,
} from "@/modules/loyalty/loyalty.service";
import { finalizeSale } from "@/modules/pos/pos.service";
import { createProduct } from "@/modules/products/product.service";
import { postPurchaseReceipt } from "@/modules/receiving/receipt.service";
import { createSupplier } from "@/modules/receiving/supplier.service";
import {
  createTransfer,
  dispatchTransfer,
  markTransferReady,
  receiveTransfer,
} from "@/modules/transfers/transfer.service";

const suffix = randomUUID().slice(0, 8);
const phoneTail = suffix.replace(/\D/g, "").padEnd(8, "7").slice(0, 8);
const phoneA = `98${phoneTail}`;
const phoneB = `97${phoneTail}`;
const phoneC = `96${phoneTail}`;

let owner: SessionUser;
let cashier: SessionUser;
let warehouseActor: SessionUser;
let productId: string;
let customerAId: string;
let customerBId: string;
let customerCId: string;
let secondSaleId: string;

beforeAll(async () => {
  const ownerRecord = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.SEED_OWNER_EMAIL!.toLowerCase() },
  });

  owner = {
    id: ownerRecord.id,
    name: ownerRecord.name,
    email: ownerRecord.email,
    role: ownerRecord.role,
  };

  cashier = {
    ...owner,
    role: Role.CASHIER_STORE,
  };

  warehouseActor = {
    ...owner,
    role: Role.WAREHOUSE_STAFF,
  };

  const product = await createProduct(owner, {
    sku: `PHASE5-${suffix}`,
    barcode: `55${phoneTail}`,
    name: "Phase 5 Loyalty Product",
    category: "Test",
    unit: "pcs",
    costPrice: "30.00",
    sellingPrice: "50.00",
    mrp: "55.00",
    warehouseMinStock: "0",
    storeMinStock: "0",
    active: true,
  });

  productId = product.id;

  const supplier = await createSupplier(owner, {
    name: `Phase 5 Supplier ${suffix}`,
    phone: "",
    notes: "Loyalty integration setup",
  });

  await postPurchaseReceipt(warehouseActor, {
    supplierId: supplier.id,
    supplierReference: `PHASE5-OPENING-${suffix}`,
    notes: "Opening loyalty test stock",
    idempotencyKey: `phase5-opening-${suffix}`,
    items: [
      {
        productId,
        quantity: "100",
        unitCost: "30.00",
      },
    ],
  });

  const transfer = await createTransfer(warehouseActor, {
    notes: "Move loyalty test stock to store",
    items: [
      {
        productId,
        requestedQuantity: "100",
      },
    ],
  });

  await markTransferReady(warehouseActor, transfer.id);
  const dispatched = await dispatchTransfer(warehouseActor, transfer.id, {
    idempotencyKey: `phase5-dispatch-${suffix}`,
  });

  await receiveTransfer(cashier, transfer.id, {
    idempotencyKey: `phase5-receive-${suffix}`,
    items: [
      {
        transferItemId: dispatched.items[0].id,
        receivedQuantity: "100",
        discrepancyReason: "",
      },
    ],
  });

  const [customerA, customerB, customerC] = await Promise.all([
    createCustomer(cashier, {
      phone: phoneA,
      name: "Loyalty Customer A",
      notes: "",
    }),
    createCustomer(owner, {
      phone: phoneB,
      name: "Loyalty Customer B",
      notes: "",
    }),
    createCustomer(cashier, {
      phone: phoneC,
      name: "Loyalty Customer C",
      notes: "",
    }),
  ]);

  customerAId = customerA.id;
  customerBId = customerB.id;
  customerCId = customerC.id;
});

async function account(customerId: string) {
  return prisma.loyaltyAccount.findUniqueOrThrow({
    where: { customerId },
  });
}

describe("Phase 5 customers and loyalty", () => {
  it("normalizes equivalent Nepal phone formats to one customer identity", async () => {
    const formatted = `+977 ${phoneA.slice(0, 2)} ${phoneA.slice(2, 6)} ${phoneA.slice(6)}`;
    const international00 = `00977-${phoneA}`;

    expect(normalizeCustomerPhone(phoneA)).toBe(`+977${phoneA}`);
    expect(normalizeCustomerPhone(formatted)).toBe(`+977${phoneA}`);
    expect(normalizeCustomerPhone(international00)).toBe(`+977${phoneA}`);

    const found = await findCustomerByPhone(formatted);
    expect(found?.id).toBe(customerAId);

    await expect(
      createCustomer(cashier, {
        phone: formatted,
        name: "Duplicate formatting",
        notes: "",
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "CUSTOMER_EXISTS",
    });

    expect(
      await prisma.customer.count({
        where: { phoneNormalized: `+977${phoneA}` },
      }),
    ).toBe(1);
  });

  it("blocks warehouse staff from creating customers", async () => {
    await expect(
      createCustomer(warehouseActor, {
        phone: `95${phoneTail}`,
        name: "Unauthorized Customer",
        notes: "",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("earns no point on NPR 300 and carries NPR 300 remainder", async () => {
    const result = await finalizeSale(cashier, {
      idempotencyKey: `phase5-a-300-${suffix}`,
      paymentMethod: PaymentMethod.CASH,
      customerId: customerAId,
      items: [
        {
          productId,
          quantity: "6",
        },
      ],
    });

    expect(result.sale.total.toFixed(2)).toBe("300.00");
    expect(result.sale.customerId).toBe(customerAId);
    expect(result.loyaltyTransaction?.type).toBe(
      LoyaltyTransactionType.EARN,
    );
    expect(result.loyaltyTransaction?.pointsDelta).toBe(0);
    expect(result.loyaltyTransaction?.eligibleSpendDelta.toFixed(2)).toBe(
      "300.00",
    );

    const loyalty = await account(customerAId);
    expect(loyalty.pointBalance).toBe(0);
    expect(loyalty.spendRemainder.toFixed(2)).toBe("300.00");
  });

  it("NPR 300 + NPR 250 becomes 1 point with NPR 50 remainder", async () => {
    const result = await finalizeSale(cashier, {
      idempotencyKey: `phase5-a-250-${suffix}`,
      paymentMethod: PaymentMethod.QR_NON_CASH,
      customerId: customerAId,
      items: [
        {
          productId,
          quantity: "5",
        },
      ],
    });

    secondSaleId = result.sale.id;

    expect(result.sale.total.toFixed(2)).toBe("250.00");
    expect(result.loyaltyTransaction?.pointsDelta).toBe(1);

    const loyalty = await account(customerAId);
    expect(loyalty.pointBalance).toBe(1);
    expect(loyalty.spendRemainder.toFixed(2)).toBe("50.00");
  });

  it("replaying an identified sale does not earn loyalty twice", async () => {
    const replay = await finalizeSale(cashier, {
      idempotencyKey: `phase5-a-250-${suffix}`,
      paymentMethod: PaymentMethod.QR_NON_CASH,
      customerId: customerAId,
      items: [
        {
          productId,
          quantity: "5",
        },
      ],
    });

    expect(replay.sale.id).toBe(secondSaleId);

    const loyalty = await account(customerAId);
    expect(loyalty.pointBalance).toBe(1);
    expect(loyalty.spendRemainder.toFixed(2)).toBe("50.00");

    expect(
      await prisma.loyaltyTransaction.count({
        where: {
          sourceType: LoyaltySourceType.SALE,
          sourceId: secondSaleId,
          type: LoyaltyTransactionType.EARN,
        },
      }),
    ).toBe(1);
  });

  it("with NPR 50 remainder, NPR 1,450 earns 3 more points and clears remainder", async () => {
    const result = await finalizeSale(owner, {
      idempotencyKey: `phase5-a-1450-${suffix}`,
      paymentMethod: PaymentMethod.CASH,
      customerId: customerAId,
      items: [
        {
          productId,
          quantity: "29",
        },
      ],
    });

    expect(result.sale.total.toFixed(2)).toBe("1450.00");
    expect(result.loyaltyTransaction?.pointsDelta).toBe(3);

    const loyalty = await account(customerAId);
    expect(loyalty.pointBalance).toBe(4);
    expect(loyalty.spendRemainder.toFixed(2)).toBe("0.00");
  });

  it("exact NPR 500 first threshold earns 1 point with zero remainder", async () => {
    const result = await finalizeSale(cashier, {
      idempotencyKey: `phase5-c-500-${suffix}`,
      paymentMethod: PaymentMethod.CASH,
      customerId: customerCId,
      items: [
        {
          productId,
          quantity: "10",
        },
      ],
    });

    expect(result.loyaltyTransaction?.pointsDelta).toBe(1);

    const loyalty = await account(customerCId);
    expect(loyalty.pointBalance).toBe(1);
    expect(loyalty.spendRemainder.toFixed(2)).toBe("0.00");
  });

  it("anonymous POS sale creates no loyalty transaction", async () => {
    const result = await finalizeSale(cashier, {
      idempotencyKey: `phase5-anonymous-${suffix}`,
      paymentMethod: PaymentMethod.CASH,
      customerId: null,
      items: [
        {
          productId,
          quantity: "1",
        },
      ],
    });

    expect(result.sale.customerId).toBeNull();
    expect(result.loyaltyTransaction).toBeNull();

    expect(
      await prisma.loyaltyTransaction.count({
        where: {
          sourceType: LoyaltySourceType.SALE,
          sourceId: result.sale.id,
        },
      }),
    ).toBe(0);
  });

  it("reversal crosses thresholds backward using net eligible spend", async () => {
    const sale = await finalizeSale(cashier, {
      idempotencyKey: `phase5-b-750-${suffix}`,
      paymentMethod: PaymentMethod.CASH,
      customerId: customerBId,
      items: [
        {
          productId,
          quantity: "15",
        },
      ],
    });

    let loyalty = await account(customerBId);
    expect(loyalty.pointBalance).toBe(1);
    expect(loyalty.spendRemainder.toFixed(2)).toBe("250.00");

    const reversal = await prisma.$transaction((tx) =>
      applyEligibleSpendReversal(tx, {
        customerId: customerBId,
        amount: new Prisma.Decimal("300.00"),
        sourceType: LoyaltySourceType.SALE,
        sourceId: sale.sale.id,
        idempotencyKey: `phase5-b-reversal-${suffix}`,
        actorUserId: owner.id,
        reason: "Phase 5 reversal algorithm test",
      }),
    );

    expect(reversal.type).toBe(LoyaltyTransactionType.REVERSAL);
    expect(reversal.pointsDelta).toBe(-1);
    expect(reversal.eligibleSpendDelta.toFixed(2)).toBe("-300.00");

    loyalty = await account(customerBId);
    expect(loyalty.pointBalance).toBe(0);
    expect(loyalty.spendRemainder.toFixed(2)).toBe("450.00");

    const reconciliation = await reconcileLoyaltyAccount(customerBId);
    expect(reconciliation.matches).toBe(true);
    expect(reconciliation.ledgerEligibleSpend.toFixed(2)).toBe("450.00");
  });

  it("loyalty account reconciles exactly to immutable ledger", async () => {
    const reconciliation = await reconcileLoyaltyAccount(customerAId);

    expect(reconciliation.matches).toBe(true);
    expect(reconciliation.accountPointBalance).toBe(4);
    expect(reconciliation.ledgerPoints).toBe(4);
    expect(reconciliation.accountSpendRemainder.toFixed(2)).toBe("0.00");
    expect(reconciliation.ledgerSpendRemainder.toFixed(2)).toBe("0.00");
    expect(reconciliation.ledgerEligibleSpend.toFixed(2)).toBe("2000.00");
  });

  it("protects loyalty ledger and normalized customer identity in PostgreSQL", async () => {
    const transaction = await prisma.loyaltyTransaction.findFirstOrThrow({
      where: { customerId: customerAId },
    });

    await expect(
      prisma.loyaltyTransaction.update({
        where: { id: transaction.id },
        data: { pointsDelta: 99 },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.customer.update({
        where: { id: customerAId },
        data: { phoneNormalized: `+97794${phoneTail}` },
      }),
    ).rejects.toThrow();

    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: customerAId },
    });

    expect(customer.phoneNormalized).toBe(`+977${phoneA}`);
  });
});
