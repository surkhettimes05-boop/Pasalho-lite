import { z } from "zod";

export const customerInputSchema = z.object({
  phone: z.string().trim().min(7).max(30),
  name: z
    .string()
    .trim()
    .max(120)
    .transform((value) => (value.length === 0 ? null : value)),
  notes: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value.length === 0 ? null : value)),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;
