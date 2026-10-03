import Link from "next/link";
import { LocationType, Prisma, Role } from "@/generated/prisma/client";
import { createTransferAction } from "@/app/(app)/transfers/actions";
import { CreateTransferForm } from "@/components/create-transfer-form";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { formatNepalDateTime } from "@/lib/time";
import { getTransferPage } from "@/modules/transfers/transfer.service";

const errors: Record<string, string> = {
  PRODUCT_NOT_AVAILABLE: "Every transfer item must use an active product.",
  WAREHOUSE_NOT_FOUND: "The central warehouse is unavailable.",
  STORE_NOT_FOUND: "The store location is unavailable.",
  INVALID_TRANSFER_INPUT: "Check the transfer item fields and try again.",
  TRANSFER_OPERATION_FAILED: "The transfer operation could not be completed.",
};

function pageNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export const dynamic = "force-dynamic";

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; page?: string }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const page = pageNumber(params.page);
  const canCreate =
    user.role === Role.OWNER_ADMIN || user.role === Role.WAREHOUSE_STAFF;

  const warehouse = await prisma.location.findFirst({
    where: {
      code: "WAREHOUSE_MAIN",
      type: LocationType.WAREHOUSE,
      active: true,
    },
    select: { id: true },
  });

  const [history, products] = await Promise.all([
    getTransferPage(page, 30),
    warehouse
      ? prisma.product.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: {
            id: true,
            sku: true,
            barcode: true,
            name: true,
            unit: true,
            stockBalances: {
              where: { locationId: warehouse.id },
              select: {
                onHand: true,
                reserved: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const productOptions = products.map((product) => {
    const balance = product.stockBalances[0];
    const onHand = balance?.onHand ?? new Prisma.Decimal(0);
    const reserved = balance?.reserved ?? new Prisma.Decimal(0);

    return {
      id: product.id,
      sku: product.sku,
      barcode: product.barcode,
      name: product.name,
      unit: product.unit,
      warehouseAvailable: onHand.sub(reserved).toString(),
    };
  });

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Inventory</p>
          <h2>Warehouse → Store transfers</h2>
          <p className="muted">
            Draft and prepare stock movements, dispatch from the warehouse, then
            explicitly receive the physical shipment at the store.
          </p>
        </div>
        <span className="status-badge">{history.total} transfers</span>
      </header>

      {params.error ? (
        <p className="error-message" role="alert">
          {errors[params.error] ?? "The transfer operation failed."}
        </p>
      ) : null}

      {canCreate ? (
        <section className="panel">
          <CreateTransferForm
            products={productOptions}
            action={createTransferAction}
          />
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">History</p>
            <h3>Transfers</h3>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Transfer</th>
                <th>Created</th>
                <th>Route</th>
                <th>Items</th>
                <th>Requested</th>
                <th>In transit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.transfers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No transfers yet.
                  </td>
                </tr>
              ) : (
                history.transfers.map((transfer) => {
                  const requested = transfer.items.reduce(
                    (sum, item) => sum.add(item.requestedQuantity),
                    new Prisma.Decimal(0),
                  );
                  const inTransit =
                    transfer.status === "DISPATCHED"
                      ? transfer.items.reduce(
                          (sum, item) =>
                            sum.add(
                              item.dispatchedQuantity ??
                                new Prisma.Decimal(0),
                            ),
                          new Prisma.Decimal(0),
                        )
                      : new Prisma.Decimal(0);

                  return (
                    <tr key={transfer.id}>
                      <td>
                        <Link
                          className="text-link"
                          href={`/transfers/${transfer.id}`}
                        >
                          {transfer.transferNumber}
                        </Link>
                      </td>
                      <td>{formatNepalDateTime(transfer.createdAt)}</td>
                      <td>
                        {transfer.fromLocation.name}
                        <small>→ {transfer.toLocation.name}</small>
                      </td>
                      <td>{transfer.items.length}</td>
                      <td>{requested.toString()}</td>
                      <td>{inTransit.toString()}</td>
                      <td>
                        <span
                          className={`type-pill transfer-status-${transfer.status.toLowerCase()}`}
                        >
                          {transfer.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <span>
            Page {history.page} of {history.totalPages} · {history.total} transfer
            {history.total === 1 ? "" : "s"}
          </span>
          <div>
            {history.page > 1 ? (
              <Link
                className="text-link"
                href={`/transfers?page=${history.page - 1}`}
              >
                Previous
              </Link>
            ) : null}
            {history.page < history.totalPages ? (
              <Link
                className="text-link"
                href={`/transfers?page=${history.page + 1}`}
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
