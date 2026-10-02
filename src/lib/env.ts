import { z } from "zod";

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(168).default(12),
});

export function parseEnv(input: NodeJS.ProcessEnv) {
  const parsed = baseEnvSchema.parse(input);

  if (!/^postgres(?:ql)?:\/\//i.test(parsed.DATABASE_URL)) {
    throw new Error("DATABASE_URL must use PostgreSQL.");
  }

  if (parsed.APP_ENV === "production") {
    const appUrl = new URL(parsed.APP_URL);

    if (appUrl.protocol !== "https:") {
      throw new Error("Production APP_URL must use HTTPS.");
    }

    if (
      parsed.AUTH_SECRET.length < 48 ||
      /replace|changeme|example|secret/i.test(parsed.AUTH_SECRET)
    ) {
      throw new Error(
        "Production AUTH_SECRET must be a unique random value of at least 48 characters.",
      );
    }
  }

  return parsed;
}

export const env = parseEnv(process.env);
