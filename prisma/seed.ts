import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hash } from "bcryptjs";
import { z } from "zod";

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

const pool = new Pool({ connectionString: env.DATABASE_URL });

async function main() {
  const passwordHash = await hash(env.SEED_OWNER_PASSWORD, 12);
  const email = env.SEED_OWNER_EMAIL.trim().toLowerCase();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO "Location" (id, code, name, type, active, "createdAt", "updatedAt")
       VALUES ($1, 'WAREHOUSE_MAIN', 'Central Warehouse', 'WAREHOUSE', TRUE, NOW(), NOW())
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, type = EXCLUDED.type,
             active = TRUE, "updatedAt" = NOW()`,
      [randomUUID()],
    );
    await client.query(
      `INSERT INTO "Location" (id, code, name, type, active, "createdAt", "updatedAt")
       VALUES ($1, 'STORE_MAIN', 'Pasalho Store', 'STORE', TRUE, NOW(), NOW())
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, type = EXCLUDED.type,
             active = TRUE, "updatedAt" = NOW()`,
      [randomUUID()],
    );
    await client.query(
      `INSERT INTO "User" (id, name, email, "passwordHash", role, active, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'OWNER_ADMIN', TRUE, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name, "passwordHash" = EXCLUDED."passwordHash",
             role = 'OWNER_ADMIN', active = TRUE, "updatedAt" = NOW()`,
      [randomUUID(), env.SEED_OWNER_NAME, email, passwordHash],
    );
    await client.query("COMMIT");
    console.log("Seeded one warehouse, one store, and the owner/admin account.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
