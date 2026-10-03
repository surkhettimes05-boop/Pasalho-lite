import { randomUUID } from "node:crypto";
import Link from "next/link";
import { LocationType, Role } from "@/generated/prisma/client";
import { adjustInventoryAction } from "@/app/(app)/inventory/actions";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import {
  getInventoryRows,
  getRecentMovements,
} from "@/modules/inventory/inventory.service";

const errors: Record<string, string> = {
  INSUFFICIENT_STOCK: "Adjustment would make stock negative.",
  RESERVED_STOCK_CONFLICT: "Adjustment would reduce stock below reserved stock.",
  IDEMPOTENCY_CONFLICT: "That adjustment request conflicts with an earlier request.",
  PRODUCT_NOT_FOUND: "Product not found.",
  LOCATION_NOT_FOUND: "Location not found.",
  INVALID_ADJUSTMENT: "Check the adjustment fields and try again.",
  UNAUTHORIZED_ACTION: "Only Owner/Admin can adjust inventory.",
  ADJUSTMENT_FAILED: "The adjustment could not be completed.",
};

function pageNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function pageHref(page: number, q: string) {
  const params = new URLSearchParams();
  params.set("page", String(page));

  if (q) {
    params.set("q", q);
  }

  return `/inventory?${params.toString()}`;
}

export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    success?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const page = pageNumber(params.page);
  const locationTypes =
    user.role === Role.CASHIER_STORE
      ? [LocationType.STORE]
      : [LocationType.WAREHOUSE, LocationType.STORE];

  const [inventoryPage, movements, products, locations] = await Promise.all([
    getInventoryRows({
      search: q,
      page,
      pageSize: 40,
      locationTypes,
    }),
    getRecentMovements(20),
    prisma.product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, sku: true, name: true },
    }),
    prisma.location.findMany({
      where: { active: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, type: true },
    }),
  ]);

  const rows = inventoryPage.rows;
  const canAdjust = user.role === Role.OWNER_ADMIN;
  const adjustmentKey = randomUUID();

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Inventory</p>
          <h2>Inventory</h2>
          <p className="muted">
            Balance is a projection. Every physical stock change must be
            explained by an immutable movement.
          </p>
        </div>
        <span className="status-badge">
          {inventoryPage.totalProducts} products
        </span>
      </header>

      {params.error ? (
        <p className="error-message" role="alert">
          {errors[params.error] ?? "The inventory operation failed."}
        </p>
      ) : null}

      {params.success ? (
        <p className="success-message" role="status">
          Stock adjustment recorded.
        </p>
      ) : null}

      {canAdjust ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Owner control</p>
              <h3>Stock adjustment</h3>
              <p className="muted">
                Use only to correct a real physical mismatch. Receiving,
                transfers, sales and returns get their own flows.
              </p>
            </div>
          </div>

          <form action={adjustInventoryAction} className="form-grid">
            <input
              type="hidden"
              name="idempotencyKey"
              value={adjustmentKey}
            />

            <label>
              Product
              <select name="productId" required defaultValue="">
                <option value="" disabled>
                  Select product
                </option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.sku} — {product.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Location
              <select name="locationId" required defaultValue="">
                <option value="" disabled>
                  Select location
                </option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} — {location.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Direction
              <select name="direction" defaultValue="IN">
                <option value="IN">Adjustment in</option>
                <option value="OUT">Adjustment out</option>
              </select>
            </label>

            <label>
              Quantity
              <input
                name="quantity"
                inputMode="decimal"
                required
                placeholder="1"
              />
            </label>

            <label className="span-2">
              Reason
              <input
                name="reason"
                required
                minLength={3}
                placeholder="Physical count correction"
              />
            </label>

            <div className="form-actions span-2">
              <button className="primary-button" type="submit">
                Record adjustment
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Balances</p>
            <h3>Current stock by location</h3>
          </div>
        </div>

        <form className="search-row" method="get">
          <input
            aria-label="Search inventory"
            defaultValue={q}
            name="q"
            placeholder="Search SKU, barcode or product name"
          />
          <button className="secondary-light-button" type="submit">
            Search
          </button>
          {q ? (
            <Link className="text-link" href="/inventory">
              Clear
            </Link>
          ) : null}
        </form>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Location</th>
                <th>SKU</th>
                <th>Product</th>
                <th>On hand</th>
                <th>Reserved</th>
                <th>Available</th>
                <th>Minimum</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-cell">
                    No matching inventory.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const lowStock = row.available.lessThanOrEqualTo(
                    row.minimumStock,
                  );

                  return (
                    <tr key={`${row.productId}-${row.locationId}`}>
                      <td>
                        <strong>{row.locationName}</strong>
                        <small>{row.locationType}</small>
                      </td>
                      <td>{row.sku}</td>
                      <td>{row.productName}</td>
                      <td>{row.onHand.toString()}</td>
                      <td>{row.reserved.toString()}</td>
                      <td>{row.available.toString()}</td>
                      <td>{row.minimumStock.toString()}</td>
                      <td>
                        <span
                          className={
                            lowStock
                              ? "type-pill warning-pill"
                              : "type-pill"
                          }
                        >
                          {lowStock ? "LOW" : "OK"}
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
            Product page {inventoryPage.page} of {inventoryPage.totalPages} ·{" "}
            {inventoryPage.totalProducts} result
            {inventoryPage.totalProducts === 1 ? "" : "s"}
          </span>
          <div>
            {inventoryPage.page > 1 ? (
              <Link
                className="text-link"
                href={pageHref(inventoryPage.page - 1, q)}
              >
                Previous
              </Link>
            ) : null}
            {inventoryPage.page < inventoryPage.totalPages ? (
              <Link
                className="text-link"
                href={pageHref(inventoryPage.page + 1, q)}
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Ledger</p>
            <h3>Recent inventory movements</h3>
          </div>
          <Link className="text-link" href="/inventory/movements">
            Full history
          </Link>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>SKU</th>
                <th>Location</th>
                <th>Movement</th>
                <th>Quantity</th>
                <th>Reason</th>
                <th>Actor</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No inventory movements yet.
                  </td>
                </tr>
              ) : (
                movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{movement.createdAt.toLocaleString("en-NP")}</td>
                    <td>
                      <strong>{movement.product.sku}</strong>
                      <small>{movement.product.name}</small>
                    </td>
                    <td>{movement.location.name}</td>
                    <td>{movement.type.replaceAll("_", " ")}</td>
                    <td>{movement.quantityDelta.toString()}</td>
                    <td>{movement.reason ?? "—"}</td>
                    <td>{movement.actor.name}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
