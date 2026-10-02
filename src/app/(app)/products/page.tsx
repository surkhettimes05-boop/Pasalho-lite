import Link from "next/link";
import { Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requirePageRole } from "@/lib/auth/require-role";
import {
  createProductAction,
  setProductActiveAction,
} from "@/app/(app)/products/actions";

const messages: Record<string, string> = {
  SKU_EXISTS: "That SKU already exists.",
  BARCODE_EXISTS: "That barcode already exists.",
  INVALID_PRODUCT: "Check the product fields and try again.",
  PRODUCT_OPERATION_FAILED: "The product operation could not be completed.",
};

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  await requirePageRole([Role.OWNER_ADMIN]);
  const params = await searchParams;

  const products = await prisma.product.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Phase 1</p>
          <h2>Products</h2>
          <p className="muted">
            Maintain the SKU catalog. Stock is controlled separately through
            ledger-backed inventory operations.
          </p>
        </div>
        <span className="status-badge">{products.length} SKUs</span>
      </header>

      {params.error ? (
        <p className="error-message" role="alert">
          {messages[params.error] ?? "The product operation failed."}
        </p>
      ) : null}

      {params.success ? (
        <p className="success-message" role="status">
          Product {params.success}.
        </p>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">New SKU</p>
            <h3>Add product</h3>
          </div>
        </div>

        <form action={createProductAction} className="form-grid">
          <label>
            SKU
            <input name="sku" required placeholder="COKE-500" />
          </label>
          <label>
            Barcode
            <input name="barcode" placeholder="Optional" />
          </label>
          <label className="span-2">
            Product name
            <input name="name" required placeholder="Coca-Cola 500 ml" />
          </label>
          <label>
            Category
            <input name="category" required placeholder="Beverages" />
          </label>
          <label>
            Unit
            <input name="unit" required placeholder="pcs" />
          </label>
          <label>
            Cost price (NPR)
            <input
              name="costPrice"
              inputMode="decimal"
              required
              defaultValue="0.00"
            />
          </label>
          <label>
            Selling price (NPR)
            <input
              name="sellingPrice"
              inputMode="decimal"
              required
              defaultValue="0.00"
            />
          </label>
          <label>
            MRP (NPR)
            <input name="mrp" inputMode="decimal" placeholder="Optional" />
          </label>
          <label>
            Warehouse minimum
            <input
              name="warehouseMinStock"
              inputMode="decimal"
              required
              defaultValue="0"
            />
          </label>
          <label>
            Store minimum
            <input
              name="storeMinStock"
              inputMode="decimal"
              required
              defaultValue="0"
            />
          </label>
          <div className="form-actions span-2">
            <button className="primary-button" type="submit">
              Add product
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Catalog</p>
            <h3>Current products</h3>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Category</th>
                <th>Unit</th>
                <th>Cost</th>
                <th>Selling</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-cell">
                    No products yet.
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <strong>{product.sku}</strong>
                      {product.barcode ? <small>{product.barcode}</small> : null}
                    </td>
                    <td>{product.name}</td>
                    <td>{product.category}</td>
                    <td>{product.unit}</td>
                    <td>Rs {product.costPrice.toFixed(2)}</td>
                    <td>Rs {product.sellingPrice.toFixed(2)}</td>
                    <td>
                      <span
                        className={
                          product.active
                            ? "type-pill"
                            : "type-pill type-pill-muted"
                        }
                      >
                        {product.active ? "ACTIVE" : "INACTIVE"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <Link
                          className="text-link"
                          href={`/products/${product.id}`}
                        >
                          Edit
                        </Link>
                        <form action={setProductActiveAction}>
                          <input
                            type="hidden"
                            name="productId"
                            value={product.id}
                          />
                          <input
                            type="hidden"
                            name="active"
                            value={product.active ? "false" : "true"}
                          />
                          <button className="link-button" type="submit">
                            {product.active ? "Deactivate" : "Activate"}
                          </button>
                        </form>
                      </div>
                    </td>
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
