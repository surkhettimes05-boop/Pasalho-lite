import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { Pool } from "pg";
import { z } from "zod";

const env = z
  .object({
    APP_ENV: z.literal("production"),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => /^postgres(?:ql)?:\/\//i.test(value), {
        message: "DATABASE_URL must be a PostgreSQL URL.",
      }),
    PRODUCTION_DATABASE_CONFIRMATION: z.literal("pasalho-lite-production"),
    RESET_OWNER_EMAIL: z.string().email(),
    RESET_OWNER_NAME: z.string().trim().min(2).max(100),
    RESET_OWNER_PASSWORD: z.string().min(16).max(256),
  })
  .parse(process.env);

const pool = new Pool({ connectionString: env.DATABASE_URL });

async function main() {
  const email = env.RESET_OWNER_EMAIL.trim().toLowerCase();
  const name = env.RESET_OWNER_NAME.trim();
  const passwordHash = await hash(env.RESET_OWNER_PASSWORD, 12);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('pasalho_lite_production_owner_reset'))",
    );

    const owners = await client.query(
      `SELECT id, name, email, role, active
         FROM "User"
        WHERE role = 'OWNER_ADMIN' AND active = TRUE
        FOR UPDATE`,
    );
    if (owners.rowCount !== 1) {
      throw new Error(
        `Reset refused: expected exactly one active Owner/Admin, found ${owners.rowCount ?? 0}.`,
      );
    }

    const owner = owners.rows[0];
    const existing = await client.query(
      `SELECT id FROM "User" WHERE lower(email) = $1 AND id <> $2 LIMIT 1`,
      [email, owner.id],
    );
    if (existing.rowCount) {
      throw new Error(
        "Reset refused: the requested email belongs to another user.",
      );
    }

    await client.query(
      `UPDATE "User"
          SET name = $1, email = $2, "passwordHash" = $3, "updatedAt" = NOW()
        WHERE id = $4`,
      [name, email, passwordHash, owner.id],
    );
    const deletedSessions = await client.query(
      `DELETE FROM "Session" WHERE "userId" = $1`,
      [owner.id],
    );
    await client.query(
      `INSERT INTO "AuditLog" (id, "actorUserId", action, "entityType", "entityId", "beforeData", "afterData", "metadata", "createdAt")
       VALUES ($1, NULL, 'PRODUCTION_OWNER_CREDENTIALS_RESET', 'User', $2, $3::jsonb, $4::jsonb, $5::jsonb, NOW())`,
      [
        randomUUID(),
        owner.id,
        JSON.stringify({ name: owner.name, email: owner.email, role: owner.role }),
        JSON.stringify({ name, email, role: owner.role, active: true }),
        JSON.stringify({ environment: "production", deletedSessions: deletedSessions.rowCount ?? 0 }),
      ],
    );

    await client.query("COMMIT");
    console.log(
      `Production owner credentials reset for ${email}. Existing sessions were cleared.`,
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
