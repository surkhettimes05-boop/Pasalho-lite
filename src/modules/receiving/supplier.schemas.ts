import { z } from "zod";

export const supplierInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40).transform((value) => value.length === 0 ? null : value),
  notes: z.string().trim().max(500).transform((value) => value.length === 0 ? null : value),
});

export type SupplierInput = z.infer<typeof supplierInputSchema>;
