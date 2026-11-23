import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.test", override: true, quiet: true });
const source = new URL(process.env.DATABASE_URL || "");
if (process.env.APP_ENV !== "test" || !["localhost", "127.0.0.1"].includes(source.hostname)) {
  throw new Error("Isolated tests only run against local .env.test PostgreSQL.");
}
const name = `pasalho_isolated_${randomBytes(5).toString("hex")}`;
const adminUrl = new URL(source);
adminUrl.pathname = "/postgres";
const admin = new Client({ connectionString: adminUrl.toString() });
await admin.connect();
function run(args, environment) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env: environment });
  if (result.status !== 0) throw new Error(`${args.join(" ")} failed with exit ${result.status}.`);
}
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  const target = new URL(source);
  target.pathname = `/${name}`;
  const environment = { ...process.env, DATABASE_URL: target.toString() };
  run(["node_modules/prisma/build/index.js", "migrate", "deploy"], environment);
  run(["--import", "tsx", "prisma/seed.ts"], environment);
  if (process.argv.includes("--canonical")) {
    run(["--conditions=react-server", "--import", "tsx", "scripts/canonical-e2e.ts"], environment);
  } else {
    run(["node_modules/vitest/vitest.mjs", "run"], environment);
  }
} finally {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
