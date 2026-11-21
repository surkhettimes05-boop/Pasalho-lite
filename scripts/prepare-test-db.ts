import { config } from "dotenv";
import { Pool } from "pg";
import { spawnSync } from "node:child_process";
import path from "node:path";

config({ path: ".env.test", override: false });
config({ path: ".env", override: false });

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error("TEST_DATABASE_URL is required.");
}
if (!/^postgres(?:ql):\/\//i.test(testUrl)) {
  throw new Error("TEST_DATABASE_URL must use PostgreSQL.");
}
if (/production/i.test(testUrl) || /_prod(?:duction)?(?:\?|$)/i.test(testUrl)) {
  throw new Error("Refusing to reset a URL that appears to reference production.");
}
const databaseName = decodeURIComponent(new URL(testUrl).pathname.slice(1));
if (!/(^|[_-])test($|[_-])/i.test(databaseName)) {
  throw new Error("Refusing to reset a database without a test name.");
}

const pool = new Pool({ connectionString: testUrl });

await pool.query('DROP SCHEMA IF EXISTS "public" CASCADE');
await pool.query('CREATE SCHEMA "public"');
await pool.end();

const env = {
  ...process.env,
  APP_ENV: "test",
  DATABASE_URL: testUrl,
} as NodeJS.ProcessEnv;

function run(script: string, args: string[]) {
  const result = spawnSync(process.execPath, [path.join(process.cwd(), script), ...args], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${script} ${args.join(" ")}`);
  }
}

run("node_modules/prisma/build/index.js", ["migrate", "deploy"]);
run("node_modules/tsx/dist/cli.mjs", ["prisma/seed.ts"]);
