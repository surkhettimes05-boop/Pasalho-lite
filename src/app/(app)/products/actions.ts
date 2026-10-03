"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { BusinessError } from "@/lib/business-error";
import { requireCurrentUser } from "@/lib/auth/current-user";
import {
  createProduct,
  setProductActive,
  updateProduct,
} from "@/modules/products/product.service";
import { importBulkProducts, parseProductFile, previewBulkProducts } from "@/modules/products/bulk-import.service";
import type { BulkPreviewRow } from "@/modules/products/bulk-import.schemas";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

function payload(formData: FormData, includeActive = false) {
  return {
    sku: value(formData, "sku"),
    barcode: value(formData, "barcode"),
    name: value(formData, "name"),
    category: value(formData, "category"),
    unit: value(formData, "unit"),
    costPrice: value(formData, "costPrice"),
    sellingPrice: value(formData, "sellingPrice"),
    mrp: value(formData, "mrp"),
    warehouseMinStock: value(formData, "warehouseMinStock"),
    storeMinStock: value(formData, "storeMinStock"),
    active: includeActive ? formData.get("active") === "on" : true,
  };
}

function errorCode(error: unknown) {
  if (error instanceof BusinessError) {
    return error.code;
  }

  if (error instanceof ZodError) {
    return "INVALID_PRODUCT";
  }

  return "PRODUCT_OPERATION_FAILED";
}

export type BulkImportState = { error?: string; rows?: BulkPreviewRow[]; batchId?: string; imported?: number };

export async function previewBulkImportAction(_state: BulkImportState, formData: FormData): Promise<BulkImportState> {
  const user = await requireCurrentUser();
  try {
    const file = formData.get("bulkFile");
    if (!(file instanceof File) || file.size === 0) throw new BusinessError("BULK_FILE_REQUIRED", "Choose a CSV or XLSX file.");
    const rows = await parseProductFile(file.name, new Uint8Array(await file.arrayBuffer()));
    const preview = await previewBulkProducts(user, rows);
    return { rows: preview, batchId: crypto.randomUUID() };
  } catch (error) {
    return { error: error instanceof BusinessError ? `${error.code}: ${error.message}` : "BULK_FILE_INVALID: Could not read the file." };
  }
}

export async function importBulkAction(_state: BulkImportState, formData: FormData): Promise<BulkImportState> {
  const user = await requireCurrentUser();
  try {
    const rows = JSON.parse(String(formData.get("rows") ?? "[]"));
    const result = await importBulkProducts(user, rows, String(formData.get("batchId") ?? ""), String(formData.get("fileName") ?? "upload"));
    revalidatePath("/products"); revalidatePath("/inventory");
    return { imported: result.imported };
  } catch (error) {
    return { error: error instanceof BusinessError ? `${error.code}: ${error.message}` : "BULK_IMPORT_FAILED: Import failed; nothing was imported." };
  }
}

export async function createProductAction(formData: FormData) {
  const user = await requireCurrentUser();

  try {
    await createProduct(user, payload(formData));
  } catch (error) {
    redirect(`/products?error=${encodeURIComponent(errorCode(error))}`);
  }

  revalidatePath("/products");
  revalidatePath("/inventory");
  redirect("/products?success=created");
}

export async function updateProductAction(formData: FormData) {
  const user = await requireCurrentUser();
  const productId = value(formData, "productId");

  try {
    await updateProduct(user, productId, payload(formData, true));
  } catch (error) {
    redirect(
      `/products/${encodeURIComponent(productId)}?error=${encodeURIComponent(
        errorCode(error),
      )}`,
    );
  }

  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  revalidatePath("/inventory");
  redirect("/products?success=updated");
}

export async function setProductActiveAction(formData: FormData) {
  const user = await requireCurrentUser();
  const productId = value(formData, "productId");
  const active = value(formData, "active") === "true";

  try {
    await setProductActive(user, productId, active);
  } catch (error) {
    redirect(`/products?error=${encodeURIComponent(errorCode(error))}`);
  }

  revalidatePath("/products");
  revalidatePath("/inventory");
  redirect(`/products?success=${active ? "activated" : "deactivated"}`);
}
