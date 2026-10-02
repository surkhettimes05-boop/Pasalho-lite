import { Role } from "@/generated/prisma/client";
import { assertRole } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { supplierInputSchema, type SupplierInput } from "@/modules/receiving/supplier.schemas";

export async function createSupplier(actor: SessionUser, input: SupplierInput) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.WAREHOUSE_STAFF]);
  const parsed = supplierInputSchema.parse(input);
  return prisma.supplier.create({ data: parsed });
}
