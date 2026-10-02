import Link from "next/link";
import { LocationType, Role } from "@/generated/prisma/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { getMovementPage } from "@/modules/inventory/inventory.service";

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

  return `/inventory/movements?${params.toString()}`;
}

export const dynamic = "force-dynamic";

export default async function MovementHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const page = pageNumber(params.page);
  const locationTypes =
    user.role === Role.CASHIER_STORE
      ? [LocationType.STORE]
      : [LocationType.WAREHOUSE, LocationType.STORE];

  const history = await getMovementPage({
    search: q,
    page,
    pageSize: 50,
    locationTypes,
  });

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Inventory ledger</p>
          <h2>Movement history</h2>
          <p className="muted">
            Append-only evidence for every physical inventory change.
          </p>
        </div>
        <Link className="text-link" href="/inventory">
          Back to inventory
        </Link>
      </header>

      <section className="panel">
        <form className="search-row" method="get">
          <input
            aria-label="Search movement history"
            defaultValue={q}
            name="q"
            placeholder="Search SKU or product name"
          />
          <button className="secondary-light-button" type="submit">
            Search
          </button>
          {q ? (
            <Link className="text-link" href="/inventory/movements">
              Clear
            </Link>
          ) : null}
        </form>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>SKU</th>
                <th>Location</th>
                <th>Type</th>
                <th>Quantity</th>
                <th>Reference</th>
                <th>Reason</th>
                <th>Actor</th>
              </tr>
            </thead>
            <tbody>
              {history.movements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-cell">
                    No matching movements.
                  </td>
                </tr>
              ) : (
                history.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{movement.createdAt.toLocaleString("en-NP")}</td>
                    <td>
                      <strong>{movement.product.sku}</strong>
                      <small>{movement.product.name}</small>
                    </td>
                    <td>
                      {movement.location.name}
                      <small>{movement.location.type}</small>
                    </td>
                    <td>{movement.type.replaceAll("_", " ")}</td>
                    <td>{movement.quantityDelta.toString()}</td>
                    <td>
                      {movement.referenceType}
                      <small>{movement.referenceId}</small>
                    </td>
                    <td>{movement.reason ?? "—"}</td>
                    <td>{movement.actor.name}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <span>
            Page {history.page} of {history.totalPages} · {history.total} movement
            {history.total === 1 ? "" : "s"}
          </span>
          <div>
            {history.page > 1 ? (
              <Link
                className="text-link"
                href={pageHref(history.page - 1, q)}
              >
                Previous
              </Link>
            ) : null}
            {history.page < history.totalPages ? (
              <Link
                className="text-link"
                href={pageHref(history.page + 1, q)}
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
