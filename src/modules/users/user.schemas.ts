import { z } from "zod";
import { Role } from "@/generated/prisma/client";

export const createUserInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(256),
  role: z.enum([Role.OWNER_ADMIN, Role.CASHIER_STORE, Role.WAREHOUSE_STAFF]),
});

export const updateUserAccessInputSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum([Role.OWNER_ADMIN, Role.CASHIER_STORE, Role.WAREHOUSE_STAFF]),
  active: z.boolean(),
});

export type CreateUserInput = z.infer<typeof createUserInputSchema>;
export type UpdateUserAccessInput = z.infer<typeof updateUserAccessInputSchema>;
