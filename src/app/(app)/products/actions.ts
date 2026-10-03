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
import {
  commitBulkProductImport,
  previewBulkProductImport,
} from "@/modules/products/bulk-import.service";

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

export async function previewBulkProductImportAction(formData: FormData) {
  const user = await requireCurrentUser();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return {
      ok: false as const,
      code: "BULK_FILE_REQUIRED",
      message: "Choose a CSV or XLSX file.",
    };
  }

  try {
    const preview = await previewBulkProductImport(user, file);
    return { ok: true as const, preview };
  } catch (error) {
    return {
      ok: false as const,
      code: error instanceof BusinessError ? error.code : "BULK_IMPORT_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "The bulk product file could not be previewed.",
    };
  }
}

export async function commitBulkProductImportAction(formData: FormData) {
  const user = await requireCurrentUser();
  const file = formData.get("file");
  const idempotencyKey = value(formData, "idempotencyKey");

  if (!(file instanceof File)) {
    return {
      ok: false as const,
      code: "BULK_FILE_REQUIRED",
      message: "Choose a CSV or XLSX file.",
    };
  }

  try {
    const result = await commitBulkProductImport(user, {
      file,
      idempotencyKey,
    });
    revalidatePath("/products");
    revalidatePath("/inventory");
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      code: error instanceof BusinessError ? error.code : "BULK_IMPORT_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "The bulk product import could not be completed.",
    };
  }
}
