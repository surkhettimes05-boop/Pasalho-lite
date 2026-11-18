import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hash } from "bcryptjs";
import { z } from "zod";

const schema = z.object({
  APP_ENV: z.enum(["staging", "production"]),
  DATABASE_URL: z.string().min(1),
  BOOTSTRAP_OWNER_EMAIL: z.string().email(),
  BOOTSTRAP_OWNER_PASSWORD: z.string().min(14).max(256),
  BOOTSTRAP_OWNER_NAME: z.string().trim().min(2).max(100),
});

const env = schema.parse(process.env);
const pool = new Pool({ connectionString: env.DATABASE_URL });

async function main() {
  const email = env.BOOTSTRAP_OWNER_EMAIL.trim().toLowerCase();
  const passwordHash = await hash(env.BOOTSTRAP_OWNER_PASSWORD, 12);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    // Serialize bootstrap attempts so two operators cannot create parallel owners.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('pasalho_owner_bootstrap'))");

    const activeOwners = await client.query(
      `SELECT COUNT(*)::int AS count
         FROM "User"
        WHERE role = 'OWNER_ADMIN' AND active = TRUE`,
    );
    if (Number(activeOwners.rows[0]?.count ?? 0) > 0) {
      throw new Error(
        "Bootstrap refused: an active Owner/Admin already exists. Use Users / Audit.",
      );
    }

    const existing = await client.query(
      'SELECT id FROM "User" WHERE email = $1 LIMIT 1',
      [email],
    );
    if (existing.rowCount) {
      throw new Error(
        "Bootstrap refused: that email already exists. Resolve it explicitly.",
      );
    }

    const warehouseId = randomUUID();
    const storeId = randomUUID();
    const userId = randomUUID();

    const warehouse = await client.query(
      `INSERT INTO "Location" (id, code, name, type, active, "createdAt", "updatedAt")
       VALUES ($1, 'WAREHOUSE_MAIN', 'Central Warehouse', 'WAREHOUSE', TRUE, NOW(), NOW())
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, type = EXCLUDED.type,
             active = TRUE, "updatedAt" = NOW()
       RETURNING id, code`,
      [warehouseId],
    );
    const store = await client.query(
      `INSERT INTO "Location" (id, code, name, type, active, "createdAt", "updatedAt")
       VALUES ($1, 'STORE_MAIN', 'Pasalho Store', 'STORE', TRUE, NOW(), NOW())
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, type = EXCLUDED.type,
             active = TRUE, "updatedAt" = NOW()
       RETURNING id, code`,
      [storeId],
    );
    const user = await client.query(
      `INSERT INTO "User" (id, name, email, "passwordHash", role, active, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'OWNER_ADMIN', TRUE, NOW(), NOW())
       RETURNING id, name, email, role, active`,
      [userId, env.BOOTSTRAP_OWNER_NAME, email, passwordHash],
    );

    const afterData = {
      name: user.rows[0].name,
      email: user.rows[0].email,
      role: user.rows[0].role,
      active: user.rows[0].active,
      warehouseId: warehouse.rows[0].id,
      storeId: store.rows[0].id,
      environment: env.APP_ENV,
    };
    await client.query(
      `INSERT INTO "AuditLog" (id, "actorUserId", action, "entityType", "entityId", "afterData", "createdAt")
       VALUES ($1, NULL, 'PRODUCTION_BOOTSTRAP_COMPLETED', 'User', $2, $3::jsonb, NOW())`,
      [randomUUID(), user.rows[0].id, JSON.stringify(afterData)],
    );

    await client.query("COMMIT");
    console.log(
      `Production bootstrap completed for ${user.rows[0].email}; warehouse=${warehouse.rows[0].code}; store=${store.rows[0].code}.`,
    );
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
