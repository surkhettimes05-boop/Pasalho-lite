import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

function createPrismaClient() {
  const adapter = new PrismaNeon({
    connectionString: env.DATABASE_URL,
  });

  return new PrismaClient({ adapter });
}

/**
 * Neon serverless is edge-safe on Cloudflare Workers and avoids retaining
 * node-postgres TCP pool state across Worker isolate requests.
 *
 * This module still exposes the same Prisma Client API to the application;
 * no Pasalho business logic changes.
 */
export const prisma = createPrismaClient();
