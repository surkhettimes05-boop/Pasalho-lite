import {
  CashMovementEffect,
  CashMovementType,
  CustomerOrderStatus,
  DailyCloseStatus,
  LocationType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Role,
  TransferStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  getNepalOperatingDateKey,
  nepalOperatingDayBounds,
  parseOperatingDate,
} from "@/lib/time";
import { getDailyClosePreview } from "@/modules/daily-close/daily-close.service";

const ZERO = new Prisma.Decimal(0);

function sumDecimals<T>(
  rows: T[],
  value: (row: T) => Prisma.Decimal,
) {
  return rows.reduce((sum, row) => sum.add(value(row)), new Prisma.Decimal(0));
}

function rangeBounds(startKey: string, endKey: string) {
  const startDate = parseOperatingDate(startKey);
  const endDate = parseOperatingDate(endKey);

  if (startDate.getTime() > endDate.getTime()) {
    throw new Error("Start date must be on or before end date.");
  }

  const days =
    Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;

  if (days > 31) {
    throw new Error("V1 reports support a maximum 31-day range.");
  }

  const start = nepalOperatingDayBounds(startKey).start;
  const end = nepalOperatingDayBounds(endKey).end;

  return { start, end, startDate, endDate, days };
}

function dateKeysBetween(startKey: string, endKey: string) {
  const start = parseOperatingDate(startKey);
  const end = parseOperatingDate(endKey);
  const keys: string[] = [];

  for (
    let cursor = start;
    cursor.getTime() <= end.getTime();
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    keys.push(cursor.toISOString().slice(0, 10));
  }

  return keys;
}

function roleVisibility(role: Role) {
  return {
    sales: role !== Role.WAREHOUSE_STAFF,
    cod: role !== Role.WAREHOUSE_STAFF,
    customers: role !== Role.WAREHOUSE_STAFF,
    cash: role !== Role.WAREHOUSE_STAFF,
    warehouseInventory: role !== Role.CASHIER_STORE,
    storeInventory: true,
    transfers: role !== Role.CASHIER_STORE,
  };
}

function locationTypesForRole(role: Role) {
  if (role === Role.CASHIER_STORE) {
    return [LocationType.STORE];
  }

  return [LocationType.WAREHOUSE, LocationType.STORE];
}

async function currentInventory(role: Role) {
  const locationTypes = locationTypesForRole(role);

  const [locations, products] = await Promise.all([
    prisma.location.findMany({
      where: {
        active: true,
        type: { in: locationTypes },
      },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    prisma.product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: {
        stockBalances: {
          include: {
            location: true,
          },
        },
      },
    }),
  ]);

  const rows = products.flatMap((product) =>
    locations.map((location) => {
      const balance = product.stockBalances.find(
        (entry) => entry.locationId === location.id,
      );
      const onHand = balance?.onHand ?? new Prisma.Decimal(0);
      const reserved = balance?.reserved ?? new Prisma.Decimal(0);
      const available = onHand.sub(reserved);
      const minimum =
        location.type === LocationType.WAREHOUSE
          ? product.warehouseMinStock
          : product.storeMinStock;

      return {
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        category: product.category,
        unit: product.unit,
        locationId: location.id,
        locationCode: location.code,
        locationName: location.name,
        locationType: location.type,
        onHand,
        reserved,
        available,
        minimum,
        costPrice: product.costPrice,
        stockValue: onHand.mul(product.costPrice).toDecimalPlaces(2),
        lowStock: available.lessThanOrEqualTo(minimum),
      };
    }),
  );

  return {
    rows,
    lowStock: rows.filter((row) => row.lowStock),
    warehouseValue: sumDecimals(
      rows.filter((row) => row.locationType === LocationType.WAREHOUSE),
      (row) => row.stockValue,
    ),
    storeValue: sumDecimals(
      rows.filter((row) => row.locationType === LocationType.STORE),
      (row) => row.stockValue,
    ),
  };
}

export async function getDashboardReport(
  role: Role,
  operatingDateKey = getNepalOperatingDateKey(),
) {
  const visibility = roleVisibility(role);
  const { start, end, operatingDate } =
    nepalOperatingDayBounds(operatingDateKey);

  const inventoryPromise = currentInventory(role);

  const salesPromise = visibility.sales
    ? Promise.all([
        prisma.sale.findMany({
          where: { finalizedAt: { gte: start, lt: end } },
          select: { id: true, total: true },
        }),
        prisma.customerOrder.findMany({
          where: {
            deliveredAt: { gte: start, lt: end },
            status: CustomerOrderStatus.DELIVERED,
          },
          select: { id: true, total: true },
        }),
        prisma.returnRecord.findMany({
          where: { completedAt: { gte: start, lt: end } },
          select: { refundAmount: true },
        }),
        prisma.payment.findMany({
          where: { collectedAt: { gte: start, lt: end } },
          select: { method: true, amount: true },
        }),
      ])
    : Promise.resolve([[], [], [], []] as const);

  const codPromise = visibility.cod
    ? prisma.customerOrder.findMany({
        where: {
          status: {
            in: [
              CustomerOrderStatus.NEW,
              CustomerOrderStatus.CONFIRMED,
              CustomerOrderStatus.PACKED,
              CustomerOrderStatus.DISPATCHED,
            ],
          },
        },
        orderBy: { createdAt: "asc" },
        take: 20,
        include: {
          customer: {
            select: { name: true, phoneDisplay: true },
          },
        },
      })
    : Promise.resolve([]);

  const transfersPromise = visibility.transfers
    ? prisma.transfer.findMany({
        where: {
          status: {
            in: [
              TransferStatus.DRAFT,
              TransferStatus.READY,
              TransferStatus.DISPATCHED,
            ],
          },
        },
        orderBy: { createdAt: "asc" },
        take: 20,
        include: {
          fromLocation: true,
          toLocation: true,
          items: true,
        },
      })
    : Promise.resolve([]);

  const cashPromise = visibility.cash
    ? Promise.all([
        getDailyClosePreview(operatingDateKey),
        prisma.cashMovement.findMany({
          where: {
            operatingDate,
            effect: CashMovementEffect.OUT,
            type: {
              in: [
                CashMovementType.EXPENSE,
                CashMovementType.CASH_PAYOUT,
                CashMovementType.OTHER_APPROVED,
              ],
            },
          },
          select: { amount: true },
        }),
        prisma.dailyClose.findFirst({
          orderBy: [{ operatingDate: "desc" }, { closedAt: "desc" }],
        }),
      ])
    : Promise.resolve(null);

  const [inventory, salesData, openCodOrders, openTransfers, cashData] =
    await Promise.all([
      inventoryPromise,
      salesPromise,
      codPromise,
      transfersPromise,
      cashPromise,
    ]);

  const [posSales, deliveredCod, returns, payments] = salesData;
  const posSalesValue = sumDecimals(posSales, (row) => row.total);
  const codDeliveredValue = sumDecimals(deliveredCod, (row) => row.total);
  const refunds = sumDecimals(returns, (row) => row.refundAmount);
  const grossSales = posSalesValue.add(codDeliveredValue);
  const netSales = grossSales.sub(refunds);

  const cashCollected = sumDecimals(
    payments.filter(
      (payment) =>
        payment.method === PaymentMethod.CASH ||
        payment.method === PaymentMethod.COD,
    ),
    (payment) => payment.amount,
  );
  const qrCollected = sumDecimals(
    payments.filter(
      (payment) => payment.method === PaymentMethod.QR_NON_CASH,
    ),
    (payment) => payment.amount,
  );

  const codPendingAmount = sumDecimals(
    openCodOrders,
    (order) => order.total,
  );

  return {
    operatingDateKey,
    visibility,
    grossSales,
    netSales,
    posSalesValue,
    posSalesCount: posSales.length,
    codDeliveredValue,
    cashCollected,
    qrCollected,
    refunds,
    codPendingAmount,
    expensesToday: cashData
      ? sumDecimals(cashData[1], (row) => row.amount)
      : ZERO,
    expectedCash: cashData
      ? cashData[0].snapshot.expectedCash
      : ZERO,
    activeDailyClose: cashData?.[0].activeClose ?? null,
    latestDailyClose: cashData?.[2] ?? null,
    warehouseStockValue: inventory.warehouseValue,
    storeStockValue: inventory.storeValue,
    lowStock: inventory.lowStock.slice(0, 20),
    lowStockCount: inventory.lowStock.length,
    openTransfers,
    openCodOrders,
  };
}

export async function getReportsData(
  role: Role,
  input: {
    startDateKey: string;
    endDateKey: string;
  },
) {
  const visibility = roleVisibility(role);
  const { start, end, startDate, endDate } = rangeBounds(
    input.startDateKey,
    input.endDateKey,
  );
  const inventoryPromise = currentInventory(role);

  const salesPromise = visibility.sales
    ? Promise.all([
        prisma.sale.findMany({
          where: { finalizedAt: { gte: start, lt: end } },
          orderBy: { finalizedAt: "desc" },
          include: {
            items: true,
            customer: {
              select: { name: true, phoneDisplay: true },
            },
          },
        }),
        prisma.customerOrder.findMany({
          where: {
            deliveredAt: { gte: start, lt: end },
            status: CustomerOrderStatus.DELIVERED,
          },
          orderBy: { deliveredAt: "desc" },
          include: {
            items: true,
            customer: {
              select: { name: true, phoneDisplay: true },
            },
          },
        }),
        prisma.returnRecord.findMany({
          where: { completedAt: { gte: start, lt: end } },
          orderBy: { completedAt: "desc" },
          include: { items: true },
        }),
        prisma.payment.findMany({
          where: { collectedAt: { gte: start, lt: end } },
          orderBy: { collectedAt: "desc" },
        }),
      ])
    : Promise.resolve([[], [], [], []] as const);

  const codPromise = visibility.cod
    ? Promise.all([
        prisma.customerOrder.findMany({
          where: { createdAt: { gte: start, lt: end } },
          orderBy: { createdAt: "desc" },
          include: {
            customer: {
              select: { name: true, phoneDisplay: true },
            },
          },
        }),
        prisma.customerOrder.findMany({
          where: {
            paymentStatus: PaymentStatus.PENDING,
            status: { not: CustomerOrderStatus.CANCELLED },
          },
          orderBy: { createdAt: "asc" },
          take: 100,
          include: {
            customer: {
              select: { name: true, phoneDisplay: true },
            },
          },
        }),
      ])
    : Promise.resolve([[], []] as const);

  const inventoryMovementPromise = prisma.inventoryMovement.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      location: {
        type: { in: locationTypesForRole(role) },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      product: { select: { sku: true, name: true } },
      location: { select: { name: true, code: true, type: true } },
      actor: { select: { name: true } },
    },
  });

  const transferPromise = visibility.transfers
    ? prisma.transfer.findMany({
        where: { createdAt: { gte: start, lt: end } },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          fromLocation: true,
          toLocation: true,
          items: true,
        },
      })
    : Promise.resolve([]);

  const cashPromise = visibility.cash
    ? Promise.all([
        prisma.cashMovement.findMany({
          where: {
            operatingDate: { gte: startDate, lte: endDate },
            effect: CashMovementEffect.OUT,
            type: {
              in: [
                CashMovementType.EXPENSE,
                CashMovementType.CASH_PAYOUT,
                CashMovementType.OTHER_APPROVED,
              ],
            },
          },
          orderBy: [{ operatingDate: "desc" }, { createdAt: "desc" }],
          take: 100,
          include: { user: { select: { name: true } } },
        }),
        prisma.dailyClose.findMany({
          where: {
            operatingDate: { gte: startDate, lte: endDate },
          },
          orderBy: [{ operatingDate: "desc" }, { closedAt: "desc" }],
          take: 100,
          include: {
            closedBy: { select: { name: true } },
            reopenedBy: { select: { name: true } },
          },
        }),
      ])
    : Promise.resolve([[], []] as const);

  const customerPromise = visibility.customers
    ? prisma.customer.findMany({
        where: {
          OR: [
            { sales: { some: { finalizedAt: { gte: start, lt: end } } } },
            {
              customerOrders: {
                some: { deliveredAt: { gte: start, lt: end } },
              },
            },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 50,
        include: {
          loyaltyAccount: true,
          sales: {
            where: { finalizedAt: { gte: start, lt: end } },
            select: { total: true },
          },
          customerOrders: {
            where: {
              deliveredAt: { gte: start, lt: end },
              status: CustomerOrderStatus.DELIVERED,
            },
            select: { total: true },
          },
        },
      })
    : Promise.resolve([]);

  const [
    inventory,
    salesData,
    codData,
    movements,
    transfers,
    cashData,
    customers,
  ] = await Promise.all([
    inventoryPromise,
    salesPromise,
    codPromise,
    inventoryMovementPromise,
    transferPromise,
    cashPromise,
    customerPromise,
  ]);

  const [sales, deliveredOrders, returns, payments] = salesData;
  const [codOrders, pendingCod] = codData;
  const [expenses, dailyCloses] = cashData;

  const dailyMap = new Map(
    dateKeysBetween(input.startDateKey, input.endDateKey).map((key) => [
      key,
      {
        date: key,
        posGross: new Prisma.Decimal(0),
        codGross: new Prisma.Decimal(0),
        refunds: new Prisma.Decimal(0),
      },
    ]),
  );

  for (const sale of sales) {
    const key = getNepalOperatingDateKey(sale.finalizedAt);
    dailyMap.get(key)?.posGross.iadd(sale.total);
  }

  for (const order of deliveredOrders) {
    if (!order.deliveredAt) continue;
    const key = getNepalOperatingDateKey(order.deliveredAt);
    dailyMap.get(key)?.codGross.iadd(order.total);
  }

  for (const record of returns) {
    const key = getNepalOperatingDateKey(record.completedAt);
    dailyMap.get(key)?.refunds.iadd(record.refundAmount);
  }

  const dailySales = Array.from(dailyMap.values()).map((row) => ({
    ...row,
    gross: row.posGross.add(row.codGross),
    net: row.posGross.add(row.codGross).sub(row.refunds),
  }));

  const paymentSplit = [
    PaymentMethod.CASH,
    PaymentMethod.QR_NON_CASH,
    PaymentMethod.COD,
  ].map((method) => ({
    method,
    amount: sumDecimals(
      payments.filter((payment) => payment.method === method),
      (payment) => payment.amount,
    ),
    count: payments.filter((payment) => payment.method === method).length,
  }));

  const skuMap = new Map<
    string,
    {
      productId: string;
      sku: string;
      name: string;
      quantity: Prisma.Decimal;
      gross: Prisma.Decimal;
    }
  >();

  function addSkuLine(line: {
    productId: string;
    skuSnapshot: string;
    productNameSnapshot: string;
    quantity: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
  }) {
    const current = skuMap.get(line.productId) ?? {
      productId: line.productId,
      sku: line.skuSnapshot,
      name: line.productNameSnapshot,
      quantity: new Prisma.Decimal(0),
      gross: new Prisma.Decimal(0),
    };

    current.quantity = current.quantity.add(line.quantity);
    current.gross = current.gross.add(line.lineTotal);
    skuMap.set(line.productId, current);
  }

  for (const sale of sales) {
    for (const line of sale.items) addSkuLine(line);
  }

  for (const order of deliveredOrders) {
    for (const line of order.items) addSkuLine(line);
  }

  const skuSales = Array.from(skuMap.values()).sort((a, b) =>
    b.gross.comparedTo(a.gross),
  );

  const codStatus = Object.values(CustomerOrderStatus).map((status) => ({
    status,
    count: codOrders.filter((order) => order.status === status).length,
    amount: sumDecimals(
      codOrders.filter((order) => order.status === status),
      (order) => order.total,
    ),
  }));

  const customerHistory = customers.map((customer) => ({
    id: customer.id,
    name: customer.name,
    phoneDisplay: customer.phoneDisplay,
    pointBalance: customer.loyaltyAccount?.pointBalance ?? 0,
    spendRemainder:
      customer.loyaltyAccount?.spendRemainder ?? new Prisma.Decimal(0),
    posValue: sumDecimals(customer.sales, (sale) => sale.total),
    codValue: sumDecimals(
      customer.customerOrders,
      (order) => order.total,
    ),
    purchaseCount:
      customer.sales.length + customer.customerOrders.length,
  }));

  return {
    startDateKey: input.startDateKey,
    endDateKey: input.endDateKey,
    visibility,
    dailySales,
    paymentSplit,
    skuSales,
    lowStock: inventory.lowStock,
    inventoryRows: inventory.rows,
    warehouseStockValue: inventory.warehouseValue,
    storeStockValue: inventory.storeValue,
    movements,
    transfers,
    codStatus,
    pendingCod,
    pendingCodAmount: sumDecimals(pendingCod, (order) => order.total),
    returns,
    expenses,
    dailyCloses,
    customerHistory,
  };
}
