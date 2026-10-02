import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CashMovementEffect,
  CashMovementType,
  CustomerOrderStatus,
  DailyCloseStatus,
  InventoryMovementType,
  LoyaltySourceType,
  PaymentMethod,
  PaymentSourceType,
  PaymentStatus,
  Prisma,
  ReturnKind,
  ReturnSourceType,
  ReturnStatus,
  Role,
  SaleStatus,
  TransferStatus,
} from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  nepalOperatingDayBounds,
  parseOperatingDate,
} from "@/lib/time";
import {
  getDashboardReport,
  getReportsData,
} from "@/modules/reports/report.service";

const suffix = randomUUID().slice(0, 8);
const dateKey = "2026-09-20";

let owner: SessionUser;
let warehouseId: string;
let storeId: string;
let productId: string;
let customerId: string;
let saleCashId: string;
let saleCashLineId: string;
let returnId: string;

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

  const [warehouse, store] = await Promise.all([
    prisma.location.findUniqueOrThrow({ where: { code: "WAREHOUSE_MAIN" } }),
    prisma.location.findUniqueOrThrow({ where: { code: "STORE_MAIN" } }),
  ]);

  warehouseId = warehouse.id;
  storeId = store.id;

  const product = await prisma.product.create({
    data: {
      sku: `P9-${suffix}`,
      barcode: `P9BAR${suffix}`,
      name: "Phase 9 Report Product",
      category: "Report Test",
      unit: "pcs",
      costPrice: new Prisma.Decimal("50.00"),
      sellingPrice: new Prisma.Decimal("500.00"),
      mrp: new Prisma.Decimal("550.00"),
      warehouseMinStock: new Prisma.Decimal("5"),
      storeMinStock: new Prisma.Decimal("2"),
      active: true,
    },
  });
  productId = product.id;

  const customer = await prisma.customer.create({
    data: {
      phoneNormalized: `+97794${suffix.replace(/\D/g, "").padEnd(8, "3").slice(0, 8)}`,
      phoneDisplay: `94${suffix.replace(/\D/g, "").padEnd(8, "3").slice(0, 8)}`,
      name: "Phase 9 Customer",
      loyaltyAccount: {
        create: {
          pointBalance: 3,
          spendRemainder: new Prisma.Decimal("350.00"),
        },
      },
    },
  });
  customerId = customer.id;

  const { start } = nepalOperatingDayBounds(dateKey);
  const at = (hours: number) =>
    new Date(start.getTime() + hours * 60 * 60 * 1000);

  await prisma.stockBalance.createMany({
    data: [
      {
        productId,
        locationId: warehouseId,
        onHand: new Prisma.Decimal("10"),
        reserved: new Prisma.Decimal("0"),
      },
      {
        productId,
        locationId: storeId,
        onHand: new Prisma.Decimal("1"),
        reserved: new Prisma.Decimal("0"),
      },
    ],
  });

  await prisma.inventoryMovement.createMany({
    data: [
      {
        productId,
        locationId: warehouseId,
        type: InventoryMovementType.ADJUSTMENT_IN,
        quantityDelta: new Prisma.Decimal("10"),
        referenceType: "PHASE9_TEST",
        referenceId: randomUUID(),
        idempotencyKey: `p9-inv-wh-${suffix}`,
        reason: "Phase 9 warehouse report seed",
        actorUserId: owner.id,
        createdAt: at(1),
      },
      {
        productId,
        locationId: storeId,
        type: InventoryMovementType.ADJUSTMENT_IN,
        quantityDelta: new Prisma.Decimal("1"),
        referenceType: "PHASE9_TEST",
        referenceId: randomUUID(),
        idempotencyKey: `p9-inv-store-${suffix}`,
        reason: "Phase 9 store report seed",
        actorUserId: owner.id,
        createdAt: at(1),
      },
    ],
  });

  const cashSale = await prisma.sale.create({
    data: {
      receiptNumber: `P9-CASH-${suffix}`,
      storeLocationId: storeId,
      customerId,
      status: SaleStatus.PARTIALLY_RETURNED,
      subtotal: new Prisma.Decimal("1000.00"),
      discountTotal: new Prisma.Decimal("0"),
      total: new Prisma.Decimal("1000.00"),
      paymentStatus: PaymentStatus.PARTIALLY_REFUNDED,
      finalizedAt: at(2),
      finalizedByUserId: owner.id,
      idempotencyKey: `p9-cash-sale-${suffix}`,
      items: {
        create: {
          productId,
          skuSnapshot: product.sku,
          productNameSnapshot: product.name,
          quantity: new Prisma.Decimal("2"),
          unitPrice: new Prisma.Decimal("500.00"),
          discountAmount: new Prisma.Decimal("0"),
          lineTotal: new Prisma.Decimal("1000.00"),
          unitCostSnapshot: new Prisma.Decimal("50.00"),
        },
      },
    },
    include: { items: true },
  });
  saleCashId = cashSale.id;
  saleCashLineId = cashSale.items[0].id;

  const qrSale = await prisma.sale.create({
    data: {
      receiptNumber: `P9-QR-${suffix}`,
      storeLocationId: storeId,
      customerId,
      status: SaleStatus.FINALIZED,
      subtotal: new Prisma.Decimal("300.00"),
      discountTotal: new Prisma.Decimal("0"),
      total: new Prisma.Decimal("300.00"),
      paymentStatus: PaymentStatus.PAID,
      finalizedAt: at(3),
      finalizedByUserId: owner.id,
      idempotencyKey: `p9-qr-sale-${suffix}`,
      items: {
        create: {
          productId,
          skuSnapshot: product.sku,
          productNameSnapshot: product.name,
          quantity: new Prisma.Decimal("1"),
          unitPrice: new Prisma.Decimal("300.00"),
          discountAmount: new Prisma.Decimal("0"),
          lineTotal: new Prisma.Decimal("300.00"),
          unitCostSnapshot: new Prisma.Decimal("50.00"),
        },
      },
    },
  });

  await prisma.payment.createMany({
    data: [
      {
        sourceType: PaymentSourceType.SALE,
        sourceId: cashSale.id,
        method: PaymentMethod.CASH,
        status: PaymentStatus.PARTIALLY_REFUNDED,
        amount: new Prisma.Decimal("1000.00"),
        collectedAt: at(2),
        refundedAmount: new Prisma.Decimal("200.00"),
        idempotencyKey: `p9-pay-cash-${suffix}`,
        recordedByUserId: owner.id,
      },
      {
        sourceType: PaymentSourceType.SALE,
        sourceId: qrSale.id,
        method: PaymentMethod.QR_NON_CASH,
        status: PaymentStatus.PAID,
        amount: new Prisma.Decimal("300.00"),
        collectedAt: at(3),
        refundedAmount: new Prisma.Decimal("0"),
        idempotencyKey: `p9-pay-qr-${suffix}`,
        recordedByUserId: owner.id,
      },
    ],
  });

  const deliveredOrder = await prisma.customerOrder.create({
    data: {
      orderNumber: `P9-COD-${suffix}`,
      customerId,
      storeLocationId: storeId,
      status: CustomerOrderStatus.DELIVERED,
      phoneSnapshot: customer.phoneDisplay,
      addressText: "Phase 9 report address",
      subtotal: new Prisma.Decimal("500.00"),
      discountTotal: new Prisma.Decimal("0"),
      deliveryCharge: new Prisma.Decimal("50.00"),
      total: new Prisma.Decimal("550.00"),
      paymentMethod: PaymentMethod.COD,
      paymentStatus: PaymentStatus.PAID,
      confirmedAt: at(3),
      packedAt: at(3),
      dispatchedAt: at(4),
      deliveredAt: at(4),
      createdByUserId: owner.id,
      createIdempotencyKey: `p9-cod-create-${suffix}`,
      confirmIdempotencyKey: `p9-cod-confirm-${suffix}`,
      packIdempotencyKey: `p9-cod-pack-${suffix}`,
      dispatchIdempotencyKey: `p9-cod-dispatch-${suffix}`,
      deliverIdempotencyKey: `p9-cod-deliver-${suffix}`,
      createdAt: at(2),
      items: {
        create: {
          productId,
          skuSnapshot: product.sku,
          productNameSnapshot: product.name,
          quantity: new Prisma.Decimal("1"),
          unitPrice: new Prisma.Decimal("500.00"),
          discountAmount: new Prisma.Decimal("0"),
          lineTotal: new Prisma.Decimal("500.00"),
        },
      },
    },
  });

  await prisma.payment.create({
    data: {
      sourceType: PaymentSourceType.CUSTOMER_ORDER,
      sourceId: deliveredOrder.id,
      method: PaymentMethod.COD,
      status: PaymentStatus.PAID,
      amount: new Prisma.Decimal("550.00"),
      collectedAt: at(4),
      refundedAmount: new Prisma.Decimal("0"),
      idempotencyKey: `p9-pay-cod-${suffix}`,
      recordedByUserId: owner.id,
    },
  });

  const pendingOrder = await prisma.customerOrder.create({
    data: {
      orderNumber: `P9-PENDING-${suffix}`,
      customerId,
      storeLocationId: storeId,
      status: CustomerOrderStatus.NEW,
      phoneSnapshot: customer.phoneDisplay,
      addressText: "Phase 9 pending address",
      subtotal: new Prisma.Decimal("700.00"),
      discountTotal: new Prisma.Decimal("0"),
      deliveryCharge: new Prisma.Decimal("0"),
      total: new Prisma.Decimal("700.00"),
      paymentMethod: PaymentMethod.COD,
      paymentStatus: PaymentStatus.PENDING,
      createdByUserId: owner.id,
      createIdempotencyKey: `p9-pending-create-${suffix}`,
      createdAt: at(5),
      items: {
        create: {
          productId,
          skuSnapshot: product.sku,
          productNameSnapshot: product.name,
          quantity: new Prisma.Decimal("1"),
          unitPrice: new Prisma.Decimal("700.00"),
          discountAmount: new Prisma.Decimal("0"),
          lineTotal: new Prisma.Decimal("700.00"),
        },
      },
    },
  });

  await prisma.payment.create({
    data: {
      sourceType: PaymentSourceType.CUSTOMER_ORDER,
      sourceId: pendingOrder.id,
      method: PaymentMethod.COD,
      status: PaymentStatus.PENDING,
      amount: new Prisma.Decimal("700.00"),
      collectedAt: null,
      refundedAmount: new Prisma.Decimal("0"),
      idempotencyKey: `p9-pay-pending-${suffix}`,
      recordedByUserId: owner.id,
    },
  });

  const returnRecord = await prisma.returnRecord.create({
    data: {
      returnNumber: `P9-RET-${suffix}`,
      sourceType: ReturnSourceType.SALE,
      sourceId: cashSale.id,
      kind: ReturnKind.REFUND,
      status: ReturnStatus.COMPLETED,
      refundAmount: new Prisma.Decimal("200.00"),
      refundMethod: PaymentMethod.CASH,
      reason: "Phase 9 report refund",
      createdByUserId: owner.id,
      completedAt: at(5),
      idempotencyKey: `p9-return-${suffix}`,
      items: {
        create: {
          productId,
          originalLineId: saleCashLineId,
          quantity: new Prisma.Decimal("0.4"),
          physicallyReturned: true,
          restockQuantity: new Prisma.Decimal("0"),
          refundAmount: new Prisma.Decimal("200.00"),
        },
      },
    },
  });
  returnId = returnRecord.id;

  await prisma.loyaltyTransaction.create({
    data: {
      customerId,
      type: "REVERSAL",
      pointsDelta: 0,
      eligibleSpendDelta: new Prisma.Decimal("-200.00"),
      sourceType: LoyaltySourceType.SALE,
      sourceId: cashSale.id,
      idempotencyKey: `p9-loyalty-return-${suffix}`,
      reason: "Phase 9 reporting seed",
      actorUserId: owner.id,
      createdAt: at(5),
    },
  });

  const operatingDate = parseOperatingDate(dateKey);

  await prisma.cashMovement.createMany({
    data: [
      {
        storeLocationId: storeId,
        operatingDate,
        type: CashMovementType.OPENING_CASH,
        effect: CashMovementEffect.IN,
        amount: new Prisma.Decimal("500.00"),
        category: "OPENING_DRAWER",
        reason: "Phase 9 opening cash",
        idempotencyKey: `p9-opening-${suffix}`,
        userId: owner.id,
        createdAt: at(1),
      },
      {
        storeLocationId: storeId,
        operatingDate,
        type: CashMovementType.REFUND_OUT,
        effect: CashMovementEffect.OUT,
        amount: new Prisma.Decimal("200.00"),
        category: "RETURN_REFUND",
        reason: "Phase 9 cash refund",
        referenceType: "RETURN",
        referenceId: returnRecord.id,
        idempotencyKey: `p9-refund-out-${suffix}`,
        userId: owner.id,
        createdAt: at(5),
      },
      {
        storeLocationId: storeId,
        operatingDate,
        type: CashMovementType.EXPENSE,
        effect: CashMovementEffect.OUT,
        amount: new Prisma.Decimal("100.00"),
        category: "TEST_EXPENSE",
        reason: "Phase 9 report expense",
        idempotencyKey: `p9-expense-${suffix}`,
        userId: owner.id,
        createdAt: at(6),
      },
    ],
  });

  await prisma.dailyClose.create({
    data: {
      storeLocationId: storeId,
      operatingDate,
      openingCash: new Prisma.Decimal("500.00"),
      cashPosSales: new Prisma.Decimal("1000.00"),
      codCashCollected: new Prisma.Decimal("550.00"),
      cashAdded: new Prisma.Decimal("0"),
      cashRefunds: new Prisma.Decimal("200.00"),
      cashExpenses: new Prisma.Decimal("100.00"),
      expectedCash: new Prisma.Decimal("1750.00"),
      actualCash: new Prisma.Decimal("1700.00"),
      variance: new Prisma.Decimal("-50.00"),
      qrNonCashSales: new Prisma.Decimal("300.00"),
      pendingCodAmount: new Prisma.Decimal("700.00"),
      notes: "Phase 9 variance",
      status: DailyCloseStatus.CLOSED,
      closeIdempotencyKey: `p9-close-${suffix}`,
      closedByUserId: owner.id,
      closedAt: at(7),
    },
  });

  await prisma.transfer.create({
    data: {
      transferNumber: `P9-TR-${suffix}`,
      fromLocationId: warehouseId,
      toLocationId: storeId,
      status: TransferStatus.DRAFT,
      createdByUserId: owner.id,
      notes: "Phase 9 open transfer",
      createdAt: at(7),
      items: {
        create: {
          productId,
          requestedQuantity: new Prisma.Decimal("3"),
        },
      },
    },
  });
});

describe("Phase 9 dashboard and reports", () => {
  it("reconciles dashboard sales, payment, refund, expense and expected-cash totals", async () => {
    const dashboard = await getDashboardReport(Role.OWNER_ADMIN, dateKey);

    expect(dashboard.posSalesValue.toFixed(2)).toBe("1300.00");
    expect(dashboard.posSalesCount).toBe(2);
    expect(dashboard.codDeliveredValue.toFixed(2)).toBe("550.00");
    expect(dashboard.grossSales.toFixed(2)).toBe("1850.00");
    expect(dashboard.refunds.toFixed(2)).toBe("200.00");
    expect(dashboard.netSales.toFixed(2)).toBe("1650.00");
    expect(dashboard.cashCollected.toFixed(2)).toBe("1550.00");
    expect(dashboard.qrCollected.toFixed(2)).toBe("300.00");
    expect(dashboard.expensesToday.toFixed(2)).toBe("100.00");
    expect(dashboard.expectedCash.toFixed(2)).toBe("1750.00");

    const underlyingPos = await prisma.sale.aggregate({
      where: {
        finalizedAt: {
          gte: nepalOperatingDayBounds(dateKey).start,
          lt: nepalOperatingDayBounds(dateKey).end,
        },
      },
      _sum: { total: true },
      _count: true,
    });

    expect(dashboard.posSalesValue.equals(underlyingPos._sum.total ?? 0)).toBe(true);
    expect(dashboard.posSalesCount).toBe(underlyingPos._count);
  });

  it("reports stock value and low-stock status from current balances", async () => {
    const dashboard = await getDashboardReport(Role.OWNER_ADMIN, dateKey);

    const warehouseRow = dashboard.lowStock.find(
      (row) => row.productId === productId && row.locationId === warehouseId,
    );
    const storeRow = dashboard.lowStock.find(
      (row) => row.productId === productId && row.locationId === storeId,
    );

    expect(warehouseRow).toBeUndefined();
    expect(storeRow).toBeDefined();
    expect(storeRow?.available.toString()).toBe("1");
    expect(storeRow?.minimum.toString()).toBe("2");

    const balances = await prisma.stockBalance.findMany({
      include: { product: { select: { costPrice: true } }, location: true },
    });

    const expectedWarehouseValue = balances
      .filter((row) => row.location.type === "WAREHOUSE")
      .reduce(
        (sum, row) => sum.add(row.onHand.mul(row.product.costPrice)),
        new Prisma.Decimal(0),
      );

    const expectedStoreValue = balances
      .filter((row) => row.location.type === "STORE")
      .reduce(
        (sum, row) => sum.add(row.onHand.mul(row.product.costPrice)),
        new Prisma.Decimal(0),
      );

    expect(dashboard.warehouseStockValue.equals(expectedWarehouseValue)).toBe(true);
    expect(dashboard.storeStockValue.equals(expectedStoreValue)).toBe(true);
  });

  it("reconciles daily, payment, SKU, COD, returns, expense and close reports", async () => {
    const report = await getReportsData(Role.OWNER_ADMIN, {
      startDateKey: dateKey,
      endDateKey: dateKey,
    });

    expect(report.dailySales).toHaveLength(1);
    expect(report.dailySales[0].gross.toFixed(2)).toBe("1850.00");
    expect(report.dailySales[0].refunds.toFixed(2)).toBe("200.00");
    expect(report.dailySales[0].net.toFixed(2)).toBe("1650.00");

    const cash = report.paymentSplit.find((row) => row.method === PaymentMethod.CASH);
    const qr = report.paymentSplit.find((row) => row.method === PaymentMethod.QR_NON_CASH);
    const cod = report.paymentSplit.find((row) => row.method === PaymentMethod.COD);

    expect(cash?.amount.toFixed(2)).toBe("1000.00");
    expect(qr?.amount.toFixed(2)).toBe("300.00");
    expect(cod?.amount.toFixed(2)).toBe("550.00");

    const sku = report.skuSales.find((row) => row.productId === productId);
    expect(sku?.quantity.toString()).toBe("4");
    expect(sku?.gross.toFixed(2)).toBe("1800.00");

    const delivered = report.codStatus.find(
      (row) => row.status === CustomerOrderStatus.DELIVERED,
    );
    const pending = report.codStatus.find(
      (row) => row.status === CustomerOrderStatus.NEW,
    );

    expect(delivered?.count).toBe(1);
    expect(delivered?.amount.toFixed(2)).toBe("550.00");
    expect(pending?.count).toBe(1);
    expect(pending?.amount.toFixed(2)).toBe("700.00");

    expect(report.returns.some((record) => record.id === returnId)).toBe(true);
    expect(report.expenses.some((movement) => movement.category === "TEST_EXPENSE")).toBe(true);
    expect(
      report.dailyCloses.some(
        (close) =>
          close.operatingDate.toISOString().slice(0, 10) === dateKey &&
          close.variance.toFixed(2) === "-50.00",
      ),
    ).toBe(true);

    const customer = report.customerHistory.find((row) => row.id === customerId);
    expect(customer?.purchaseCount).toBe(3);
    expect(customer?.posValue.toFixed(2)).toBe("1300.00");
    expect(customer?.codValue.toFixed(2)).toBe("550.00");
  });

  it("keeps large current pending/open totals unbounded by UI list limits", async () => {
    const dashboard = await getDashboardReport(Role.OWNER_ADMIN, dateKey);

    const openCodWhere = {
      status: {
        in: [
          CustomerOrderStatus.NEW,
          CustomerOrderStatus.CONFIRMED,
          CustomerOrderStatus.PACKED,
          CustomerOrderStatus.DISPATCHED,
        ],
      },
    };

    const [codCount, codAggregate, transferCount] = await Promise.all([
      prisma.customerOrder.count({ where: openCodWhere }),
      prisma.customerOrder.aggregate({
        where: openCodWhere,
        _sum: { total: true },
      }),
      prisma.transfer.count({
        where: {
          status: {
            in: [
              TransferStatus.DRAFT,
              TransferStatus.READY,
              TransferStatus.DISPATCHED,
            ],
          },
        },
      }),
    ]);

    expect(dashboard.openCodCount).toBe(codCount);
    expect(
      dashboard.codPendingAmount.equals(
        codAggregate._sum.total ?? new Prisma.Decimal(0),
      ),
    ).toBe(true);
    expect(dashboard.openTransferCount).toBe(transferCount);
  });

  it("applies role-scoped visibility without changing the underlying totals", async () => {
    const cashier = await getDashboardReport(Role.CASHIER_STORE, dateKey);
    const warehouse = await getDashboardReport(Role.WAREHOUSE_STAFF, dateKey);

    expect(cashier.visibility.sales).toBe(true);
    expect(cashier.visibility.warehouseInventory).toBe(false);
    expect(cashier.visibility.transfers).toBe(false);
    expect(cashier.posSalesValue.toFixed(2)).toBe("1300.00");

    expect(warehouse.visibility.sales).toBe(false);
    expect(warehouse.visibility.cash).toBe(false);
    expect(warehouse.visibility.transfers).toBe(true);
    expect(warehouse.visibility.warehouseInventory).toBe(true);
    expect(warehouse.grossSales.toFixed(2)).toBe("0.00");

    const warehouseReport = await getReportsData(Role.WAREHOUSE_STAFF, {
      startDateKey: dateKey,
      endDateKey: dateKey,
    });
    expect(warehouseReport.visibility.sales).toBe(false);
    expect(warehouseReport.transfers.length).toBeGreaterThan(0);
  });

  it("is read-only: dashboard/report reads create or mutate no business records", async () => {
    const before = {
      sales: await prisma.sale.count(),
      orders: await prisma.customerOrder.count(),
      payments: await prisma.payment.count(),
      movements: await prisma.inventoryMovement.count(),
      cashMovements: await prisma.cashMovement.count(),
      returns: await prisma.returnRecord.count(),
      closes: await prisma.dailyClose.count(),
      audits: await prisma.auditLog.count(),
    };

    await getDashboardReport(Role.OWNER_ADMIN, dateKey);
    await getReportsData(Role.OWNER_ADMIN, {
      startDateKey: dateKey,
      endDateKey: dateKey,
    });

    const after = {
      sales: await prisma.sale.count(),
      orders: await prisma.customerOrder.count(),
      payments: await prisma.payment.count(),
      movements: await prisma.inventoryMovement.count(),
      cashMovements: await prisma.cashMovement.count(),
      returns: await prisma.returnRecord.count(),
      closes: await prisma.dailyClose.count(),
      audits: await prisma.auditLog.count(),
    };

    expect(after).toEqual(before);
  });
});
