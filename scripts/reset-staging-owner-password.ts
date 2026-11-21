import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { Pool } from "pg";
import { z } from "zod";

const env = z
  .object({
    APP_ENV: z.literal("staging"),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => /^postgres(?:ql)?:\/\//i.test(value), {
        message: "DATABASE_URL must be a PostgreSQL URL.",
      }),
    STAGING_DATABASE_CONFIRMATION: z.literal("pasalho-lite-staging"),
    RESET_OWNER_EMAIL: z.string().email(),
    RESET_OWNER_PASSWORD: z.string().min(14).max(256),
  })
  .parse(process.env);

const pool = new Pool({ connectionString: env.DATABASE_URL });

async function main() {
  const email = env.RESET_OWNER_EMAIL.trim().toLowerCase();
  const passwordHash = await hash(env.RESET_OWNER_PASSWORD, 12);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('pasalho_staging_owner_password_reset'))",
    );

    const owner = await client.query(
      `SELECT id, role, active
         FROM "User"
        WHERE email = $1
        FOR UPDATE`,
      [email],
    );
    if (owner.rowCount !== 1) {
      throw new Error("No user with that email exists in the staging database.");
    }
    if (owner.rows[0].role !== "OWNER_ADMIN" || owner.rows[0].active !== true) {
      throw new Error("Password reset is limited to an active Owner/Admin account.");
    }

    await client.query(
      `UPDATE "User"
          SET "passwordHash" = $1, "updatedAt" = NOW()
        WHERE id = $2`,
      [passwordHash, owner.rows[0].id],
    );
    await client.query(
      `INSERT INTO "AuditLog" (id, "actorUserId", action, "entityType", "entityId", "afterData", "createdAt")
       VALUES ($1, NULL, 'STAGING_OWNER_PASSWORD_RESET', 'User', $2, $3::jsonb, NOW())`,
      [
        randomUUID(),
        owner.rows[0].id,
        JSON.stringify({ email, role: owner.rows[0].role, environment: "staging" }),
      ],
    );

    await client.query("COMMIT");
    console.log(`Staging owner password reset for ${email}.`);
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
