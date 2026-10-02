import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@/generated/prisma/client";
import { updateProductAction } from "@/app/(app)/products/actions";
import { requirePageRole } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ProductEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePageRole([Role.OWNER_ADMIN]);
  const { id } = await params;
  const query = await searchParams;

  const product = await prisma.product.findUnique({
    where: { id },
  });

  if (!product) {
    notFound();
  }

  return (
    <div className="page-stack narrow-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Product</p>
          <h2>Edit {product.sku}</h2>
          <p className="muted">
            Catalog edits do not rewrite historical transaction values.
          </p>
        </div>
        <Link className="text-link" href="/products">
          Back to products
        </Link>
      </header>

      {query.error ? (
        <p className="error-message" role="alert">
          The update could not be completed. Check for duplicate SKU/barcode
          and validate all values.
        </p>
      ) : null}

      <section className="panel">
        <form action={updateProductAction} className="form-grid">
          <input type="hidden" name="productId" value={product.id} />

          <label>
            SKU
            <input name="sku" required defaultValue={product.sku} />
          </label>
          <label>
            Barcode
            <input
              name="barcode"
              defaultValue={product.barcode ?? ""}
              placeholder="Optional"
            />
          </label>
          <label className="span-2">
            Product name
            <input name="name" required defaultValue={product.name} />
          </label>
          <label>
            Category
            <input name="category" required defaultValue={product.category} />
          </label>
          <label>
            Unit
            <input name="unit" required defaultValue={product.unit} />
          </label>
          <label>
            Cost price (NPR)
            <input
              name="costPrice"
              inputMode="decimal"
              required
              defaultValue={product.costPrice.toFixed(2)}
            />
          </label>
          <label>
            Selling price (NPR)
            <input
              name="sellingPrice"
              inputMode="decimal"
              required
              defaultValue={product.sellingPrice.toFixed(2)}
            />
          </label>
          <label>
            MRP (NPR)
            <input
              name="mrp"
              inputMode="decimal"
              defaultValue={product.mrp?.toFixed(2) ?? ""}
            />
          </label>
          <label>
            Warehouse minimum
            <input
              name="warehouseMinStock"
              inputMode="decimal"
              required
              defaultValue={product.warehouseMinStock.toString()}
            />
          </label>
          <label>
            Store minimum
            <input
              name="storeMinStock"
              inputMode="decimal"
              required
              defaultValue={product.storeMinStock.toString()}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="active"
              defaultChecked={product.active}
            />
            Active
          </label>

          <div className="form-actions span-2">
            <button className="primary-button" type="submit">
              Save product
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
