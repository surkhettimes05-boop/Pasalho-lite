import { Role } from "@/generated/prisma/client";
import { requirePageRole } from "@/lib/auth/require-role";
import { getSkuReconciliationReport } from "@/modules/pricing/pricing.service";

export const dynamic = "force-dynamic";

export default async function PricingReconciliationPage() {
  const user = await requirePageRole([Role.OWNER_ADMIN]);
  let report: Awaited<ReturnType<typeof getSkuReconciliationReport>> | null =
    null;
  let errorCode = "";

  try {
    report = await getSkuReconciliationReport(user);
  } catch (error) {
    errorCode =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "PRICING_RECONCILIATION_FAILED";
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Management</p>
          <h2>Pricing / SKU reconciliation</h2>
          <p className="muted">
            Exact-SKU comparison with the authoritative modern-trade catalog.
            Product names are never used to match records.
          </p>
        </div>
        {report ? (
          <span className="status-badge">
            {report.currency} · {report.generatedAt}
          </span>
        ) : null}
      </header>

      {errorCode ? (
        <p className="error-message" role="alert">
          Reconciliation could not complete ({errorCode}). No local pricing
          fallback was used.
        </p>
      ) : null}

      {report ? (
        <>
          <section className="report-two-column">
            <article className="panel">
              <div className="panel-heading">
                <h3>Missing from modern-trade</h3>
                <span className="status-badge">
                  {report.missingInModern.length}
                </span>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Lite product ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.missingInModern.map((row) => (
                      <tr key={`${row.sku}-${row.productId}`}>
                        <td>{row.sku}</td>
                        <td>{row.productId}</td>
                      </tr>
                    ))}
                    {!report.missingInModern.length ? (
                      <tr>
                        <td colSpan={2} className="empty-cell">
                          No missing SKUs.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading">
                <h3>Missing from Lite</h3>
                <span className="status-badge">
                  {report.missingInLite.length}
                </span>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Modern product reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.missingInLite.map((row) => (
                      <tr key={`${row.sku}-${row.productReference}`}>
                        <td>{row.sku}</td>
                        <td>{row.productReference}</td>
                      </tr>
                    ))}
                    {!report.missingInLite.length ? (
                      <tr>
                        <td colSpan={2} className="empty-cell">
                          No missing SKUs.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </article>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <h3>Duplicate SKU mappings</h3>
              <span className="status-badge">
                {report.duplicateSkuMappings.length}
              </span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Lite product IDs</th>
                    <th>Modern product references</th>
                  </tr>
                </thead>
                <tbody>
                  {report.duplicateSkuMappings.map((row) => (
                    <tr key={row.sku}>
                      <td>{row.sku}</td>
                      <td>{row.liteProductIds.join(", ") || "—"}</td>
                      <td>{row.modernProductReferences.join(", ") || "—"}</td>
                    </tr>
                  ))}
                  {!report.duplicateSkuMappings.length ? (
                    <tr>
                      <td colSpan={3} className="empty-cell">
                        No duplicate SKU mappings.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <h3>Regular-price mismatches</h3>
              <span className="status-badge">
                {report.regularPriceMismatches.length}
              </span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Lite regular price</th>
                    <th>Modern regular price</th>
                  </tr>
                </thead>
                <tbody>
                  {report.regularPriceMismatches.map((row) => (
                    <tr key={row.sku}>
                      <td>{row.sku}</td>
                      <td>Rs {row.liteRegularPrice}</td>
                      <td>Rs {row.modernRegularPrice}</td>
                    </tr>
                  ))}
                  {!report.regularPriceMismatches.length ? (
                    <tr>
                      <td colSpan={3} className="empty-cell">
                        No regular-price mismatches.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="report-two-column">
            <article className="panel">
              <div className="panel-heading">
                <h3>Inactive products</h3>
                <span className="status-badge">
                  {report.inactiveProducts.length}
                </span>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Lite active</th>
                      <th>Modern active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.inactiveProducts.map((row, index) => (
                      <tr key={`${row.sku}-${index}`}>
                        <td>{row.sku}</td>
                        <td>
                          {row.liteActive === null
                            ? "missing"
                            : row.liteActive
                              ? "yes"
                              : "no"}
                        </td>
                        <td>
                          {row.modernActive === null
                            ? "missing"
                            : row.modernActive
                              ? "yes"
                              : "no"}
                        </td>
                      </tr>
                    ))}
                    {!report.inactiveProducts.length ? (
                      <tr>
                        <td colSpan={3} className="empty-cell">
                          No inactive products.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading">
                <h3>Cannot participate in member pricing</h3>
                <span className="status-badge">
                  {report.memberPricingIneligible.length}
                </span>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.memberPricingIneligible.map((row, index) => (
                      <tr key={`${row.sku}-${index}`}>
                        <td>{row.sku}</td>
                        <td>{row.reasons.join(", ")}</td>
                      </tr>
                    ))}
                    {!report.memberPricingIneligible.length ? (
                      <tr>
                        <td colSpan={2} className="empty-cell">
                          All mapped products are eligible.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}
