import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PaymentMethod,
  PrismaClient,
  Role,
} from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { getNepalOperatingDateKey } from "../src/lib/time";
import { recordCashMovement } from "../src/modules/cash/cash.service";
import { createCustomer } from "../src/modules/customers/customer.service";
import {
  closeOperatingDay,
} from "../src/modules/daily-close/daily-close.service";
import {
  reconcileInventoryBalance,
} from "../src/modules/inventory/inventory.service";
import { reconcileLoyaltyAccount } from "../src/modules/loyalty/loyalty.service";
import {
  confirmCustomerOrder,
  createCustomerOrder,
  deliverCustomerOrder,
  dispatchCustomerOrder,
  packCustomerOrder,
} from "../src/modules/orders/order.service";
import { finalizeSale } from "../src/modules/pos/pos.service";
import { createProduct } from "../src/modules/products/product.service";
import { postPurchaseReceipt } from "../src/modules/receiving/receipt.service";
import { createSupplier } from "../src/modules/receiving/supplier.service";
import {
  createTransfer,
  dispatchTransfer,
  markTransferReady,
  receiveTransfer,
} from "../src/modules/transfers/transfer.service";
import { CashMovementType } from "../src/generated/prisma/client";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function eq(actual: string | number, expected: string | number, label: string) {
  assert(
    String(actual) === String(expected),
    `${label}: expected ${expected}, got ${actual}`,
  );
}

const suffix = randomUUID().slice(0, 8);
const ownerRecord = await prisma.user.findUniqueOrThrow({
  where: { email: process.env.SEED_OWNER_EMAIL!.toLowerCase() },
});

const owner = {
  id: ownerRecord.id,
  name: ownerRecord.name,
  email: ownerRecord.email,
  role: Role.OWNER_ADMIN,
};
const cashier = { ...owner, role: Role.CASHIER_STORE };
const warehouse = { ...owner, role: Role.WAREHOUSE_STAFF };

const [warehouseLocation, storeLocation] = await Promise.all([
  prisma.location.findUniqueOrThrow({ where: { code: "WAREHOUSE_MAIN" } }),
  prisma.location.findUniqueOrThrow({ where: { code: "STORE_MAIN" } }),
]);

const product = await createProduct(owner, {
  sku: `E2E-${suffix}`,
  barcode: `E2E${suffix.replace(/\D/g, "").padEnd(10, "7")}`,
  name: "Canonical E2E Product",
  category: "Release Test",
  unit: "pcs",
  costPrice: "100.00",
  sellingPrice: "250.00",
  mrp: "275.00",
  warehouseMinStock: "0",
  storeMinStock: "0",
  active: true,
});

const supplier = await createSupplier(owner, {
  name: `Canonical Supplier ${suffix}`,
  phone: "",
  notes: "Release verification",
});

await postPurchaseReceipt(warehouse, {
  supplierId: supplier.id,
  supplierReference: `E2E-REC-${suffix}`,
  notes: "Canonical +100 receipt",
  idempotencyKey: `e2e-receipt-${suffix}`,
  items: [{ productId: product.id, quantity: "100", unitCost: "100.00" }],
});

let warehouseBalance = await prisma.stockBalance.findUniqueOrThrow({
  where: {
    productId_locationId: {
      productId: product.id,
      locationId: warehouseLocation.id,
    },
  },
});
eq(warehouseBalance.onHand.toString(), "100", "warehouse after receipt");

const transfer = await createTransfer(warehouse, {
  notes: "Canonical transfer 20",
  items: [{ productId: product.id, requestedQuantity: "20" }],
});
await markTransferReady(warehouse, transfer.id);
const dispatchedTransfer = await dispatchTransfer(warehouse, transfer.id, {
  idempotencyKey: `e2e-transfer-dispatch-${suffix}`,
});

warehouseBalance = await prisma.stockBalance.findUniqueOrThrow({
  where: {
    productId_locationId: {
      productId: product.id,
      locationId: warehouseLocation.id,
    },
  },
});
let storeBalance = await prisma.stockBalance.findUniqueOrThrow({
  where: {
    productId_locationId: {
      productId: product.id,
      locationId: storeLocation.id,
    },
  },
});
eq(warehouseBalance.onHand.toString(), "80", "warehouse after dispatch");
eq(storeBalance.onHand.toString(), "0", "store before transfer receive");

await receiveTransfer(cashier, transfer.id, {
  idempotencyKey: `e2e-transfer-receive-${suffix}`,
  items: [{
    transferItemId: dispatchedTransfer.items[0].id,
    receivedQuantity: "20",
    discrepancyReason: "",
  }],
});

storeBalance = await prisma.stockBalance.findUniqueOrThrow({
  where: {
    productId_locationId: {
      productId: product.id,
      locationId: storeLocation.id,
    },
  },
});
eq(storeBalance.onHand.toString(), "20", "store after transfer receive");

await finalizeSale(cashier, {
  idempotencyKey: `e2e-pos-${suffix}`,
  paymentMethod: PaymentMethod.CASH,
  customerId: null,
  items: [{ productId: product.id, quantity: "3" }],
});

storeBalance = await prisma.stockBalance.findUniqueOrThrow({
  where: {
    productId_locationId: {
      productId: product.id,
      locationId: storeLocation.id,
    },
  },
});
eq(storeBalance.onHand.toString(), "17", "store after POS sale");

const digits = suffix.replace(/\D/g, "").padEnd(8, "6").slice(0, 8);
const customer = await createCustomer(cashier, {
  phone: `98${digits}`,
  name: "Canonical E2E Customer",
  notes: "",
});

const order = await createCustomerOrder(cashier, {
  customerId: customer.id,
  addressText: "Canonical release address",
  deliveryCharge: "0",
  notes: "",
  idempotencyKey: `e2e-order-create-${suffix}`,
  items: [{ productId: product.id, quantity: "2" }],
});

await confirmCustomerOrder(cashier, order.id, {
  idempotencyKey: `e2e-order-confirm-${suffix}`,
});

storeBalance = await prisma.stockBalance.findUniqueOrThrow({
  where: {
    productId_locationId: {
      productId: product.id,
      locationId: storeLocation.id,
    },
  },
});
eq(storeBalance.onHand.toString(), "17", "onHand after COD confirmation");
eq(storeBalance.reserved.toString(), "2", "reserved after COD confirmation");
eq(storeBalance.onHand.sub(storeBalance.reserved).toString(), "15", "available after COD confirmation");

await packCustomerOrder(cashier, order.id, {
  idempotencyKey: `e2e-order-pack-${suffix}`,
});

const packedBalance = await prisma.stockBalance.findUniqueOrThrow({
  where: {
    productId_locationId: {
      productId: product.id,
      locationId: storeLocation.id,
    },
  },
});
eq(packedBalance.onHand.toString(), "17", "onHand after pack");
eq(packedBalance.reserved.toString(), "2", "reserved after pack");

await dispatchCustomerOrder(cashier, order.id, {
  idempotencyKey: `e2e-order-dispatch-${suffix}`,
});

storeBalance = await prisma.stockBalance.findUniqueOrThrow({
  where: {
    productId_locationId: {
      productId: product.id,
      locationId: storeLocation.id,
    },
  },
});
eq(storeBalance.onHand.toString(), "15", "onHand after COD dispatch");
eq(storeBalance.reserved.toString(), "0", "reserved after COD dispatch");

const codMovementCount = await prisma.inventoryMovement.count({
  where: {
    referenceType: "CUSTOMER_ORDER",
    referenceId: order.id,
    quantityDelta: "-2",
  },
});
eq(codMovementCount, 1, "COD dispatch movement count");

await deliverCustomerOrder(cashier, order.id, {
  idempotencyKey: `e2e-order-deliver-${suffix}`,
});

storeBalance = await prisma.stockBalance.findUniqueOrThrow({
  where: {
    productId_locationId: {
      productId: product.id,
      locationId: storeLocation.id,
    },
  },
});
eq(storeBalance.onHand.toString(), "15", "onHand after COD delivery");

const delivered = await prisma.customerOrder.findUniqueOrThrow({
  where: { id: order.id },
});
const codPayment = await prisma.payment.findFirstOrThrow({
  where: { sourceId: order.id },
});
eq(delivered.status, "DELIVERED", "COD status");
eq(codPayment.status, "PAID", "COD payment status");

const loyalty = await prisma.loyaltyAccount.findUniqueOrThrow({
  where: { customerId: customer.id },
});
eq(loyalty.pointBalance, 1, "loyalty point balance");
eq(loyalty.spendRemainder.toFixed(2), "0.00", "loyalty remainder");

const dateKey = getNepalOperatingDateKey();
await recordCashMovement(cashier, {
  operatingDate: dateKey,
  type: CashMovementType.OPENING_CASH,
  effect: null,
  amount: "1000.00",
  category: "OPENING_DRAWER",
  reason: "Canonical release opening cash",
  idempotencyKey: `e2e-opening-${suffix}`,
});
await recordCashMovement(cashier, {
  operatingDate: dateKey,
  type: CashMovementType.EXPENSE,
  effect: null,
  amount: "100.00",
  category: "RELEASE_TEST_EXPENSE",
  reason: "Canonical operating expense",
  idempotencyKey: `e2e-expense-${suffix}`,
});

const close = await closeOperatingDay(cashier, {
  operatingDate: dateKey,
  actualCash: "2100.00",
  notes: "Canonical release test variance",
  idempotencyKey: `e2e-close-${suffix}`,
});

eq(close.expectedCash.toFixed(2), "2150.00", "expected cash");
eq(close.actualCash.toFixed(2), "2100.00", "actual cash");
eq(close.variance.toFixed(2), "-50.00", "cash variance");

const inventoryReconciliation = await reconcileInventoryBalance(
  product.id,
  storeLocation.id,
);
assert(inventoryReconciliation.matches, "inventory ledger must reconcile");

const loyaltyReconciliation = await reconcileLoyaltyAccount(customer.id);
assert(loyaltyReconciliation.matches, "loyalty ledger must reconcile");

await prisma.$disconnect();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const reloaded = new PrismaClient({ adapter });

try {
  const [persistedStore, persistedClose, persistedLoyalty] = await Promise.all([
    reloaded.stockBalance.findUniqueOrThrow({
      where: {
        productId_locationId: {
          productId: product.id,
          locationId: storeLocation.id,
        },
      },
    }),
    reloaded.dailyClose.findUniqueOrThrow({ where: { id: close.id } }),
    reloaded.loyaltyAccount.findUniqueOrThrow({
      where: { customerId: customer.id },
    }),
  ]);

  eq(persistedStore.onHand.toString(), "15", "persisted store stock");
  eq(persistedClose.expectedCash.toFixed(2), "2150.00", "persisted expected cash");
  eq(persistedClose.variance.toFixed(2), "-50.00", "persisted variance");
  eq(persistedLoyalty.pointBalance, 1, "persisted loyalty");
} finally {
  await reloaded.$disconnect();
}

console.log(JSON.stringify({
  status: "ok",
  warehouseOnHand: "80",
  storeOnHand: "15",
  loyaltyPoints: 1,
  expectedCash: "2150.00",
  actualCash: "2100.00",
  variance: "-50.00",
}));
