import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.test", override: true, quiet: true });
const source = new URL(process.env.DATABASE_URL || "");
if (process.env.APP_ENV !== "test" || !["localhost", "127.0.0.1"].includes(source.hostname)) {
  throw new Error("Migration verification only runs against local .env.test PostgreSQL.");
}
const name = `pasalho_offline_migrate_${randomBytes(5).toString("hex")}`;
const adminUrl = new URL(source);
adminUrl.pathname = "/postgres";
const admin = new Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  const target = new URL(source);
  target.pathname = `/${name}`;
  const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    stdio: "inherit", env: { ...process.env, DATABASE_URL: target.toString() },
  });
  if (result.status !== 0) throw new Error(`Migration deploy failed with status ${result.status}.`);
} finally {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
