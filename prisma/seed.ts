import "dotenv/config";
import { hash } from "bcryptjs";
import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, LocationType, Role } from "../src/generated/prisma/client";

const seedEnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  SEED_OWNER_EMAIL: z.string().email(),
  SEED_OWNER_PASSWORD: z.string().min(12),
  SEED_OWNER_NAME: z.string().trim().min(1).default("Pasalho Owner"),
});

const env = seedEnvSchema.parse(process.env);

if (env.APP_ENV === "production") {
  throw new Error(
    "Production seed is disabled. Use the controlled Owner/Admin bootstrap procedure instead.",
  );
}

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await hash(env.SEED_OWNER_PASSWORD, 12);
  const email = env.SEED_OWNER_EMAIL.trim().toLowerCase();

  await prisma.$transaction([
    prisma.location.upsert({
      where: { code: "WAREHOUSE_MAIN" },
      update: {
        name: "Central Warehouse",
        type: LocationType.WAREHOUSE,
        active: true,
      },
      create: {
        code: "WAREHOUSE_MAIN",
        name: "Central Warehouse",
        type: LocationType.WAREHOUSE,
        active: true,
      },
    }),
    prisma.location.upsert({
      where: { code: "STORE_MAIN" },
      update: {
        name: "Pasalho Store",
        type: LocationType.STORE,
        active: true,
      },
      create: {
        code: "STORE_MAIN",
        name: "Pasalho Store",
        type: LocationType.STORE,
        active: true,
      },
    }),
    prisma.user.upsert({
      where: { email },
      update: {
        name: env.SEED_OWNER_NAME,
        passwordHash,
        role: Role.OWNER_ADMIN,
        active: true,
      },
      create: {
        name: env.SEED_OWNER_NAME,
        email,
        passwordHash,
        role: Role.OWNER_ADMIN,
        active: true,
      },
    }),
  ]);

  console.log("Seeded one warehouse, one store, and the owner/admin account.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
