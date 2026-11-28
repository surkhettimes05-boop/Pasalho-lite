import { Client } from "pg";

const expected = {
  host: "127.0.0.1",
  port: "55432",
  database: "pasalho_pilot_acceptance",
  schema: "public",
  user: "postgres",
};

function fail(message) {
  console.error(`Pilot database preflight failed: ${message}`);
  process.exitCode = 1;
}

let target;
try {
  target = new URL(process.env.DATABASE_URL ?? "");
} catch {
  fail("DATABASE_URL is missing or invalid.");
}

if (!target || !["postgres:", "postgresql:"].includes(target.protocol)) {
  fail("Only a PostgreSQL URL is accepted.");
} else {
  const identity = {
    host: target.hostname,
    port: target.port,
    database: target.pathname.slice(1),
    schema: target.searchParams.get("schema"),
    user: decodeURIComponent(target.username),
  };

  if (
    identity.host !== expected.host ||
    identity.port !== expected.port ||
    identity.database !== expected.database ||
    identity.schema !== expected.schema ||
    identity.user !== expected.user ||
    target.password.length > 0
  ) {
    fail("Target must be the password-free loopback pilot database on port 55432.");
  }
}

if (process.exitCode) process.exit(process.exitCode);

const client = new Client({
  host: expected.host,
  port: Number(expected.port),
  database: expected.database,
  user: expected.user,
  connectionTimeoutMillis: 3000,
});

try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const result = await client.query(`
    SELECT
      current_database() AS database,
      current_schema() AS schema,
      host(inet_server_addr()) AS server_address,
      inet_server_port()::text AS server_port,
      current_setting('server_version') AS server_version
  `);
  await client.query("ROLLBACK");

  const actual = result.rows[0];
  if (
    actual.database !== expected.database ||
    actual.schema !== expected.schema ||
    actual.server_address !== expected.host ||
    actual.server_port !== expected.port
  ) {
    throw new Error("Connected server identity did not match the isolated pilot target.");
  }

  console.log(JSON.stringify({
    status: "verified",
    host: expected.host,
    port: Number(expected.port),
    database: actual.database,
    schema: actual.schema,
    serverVersion: actual.server_version,
  }));
} catch (error) {
  try { await client.query("ROLLBACK"); } catch {}
  fail(error instanceof Error ? error.message : "Connection check failed.");
} finally {
  await client.end().catch(() => {});
}
