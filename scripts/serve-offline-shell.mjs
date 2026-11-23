import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("public");
const port = Number(process.env.OFFLINE_E2E_PORT || 3111);
const contentTypes = { ".html": "text/html", ".js": "application/javascript" };

createServer(async (request, response) => {
  const path = new URL(request.url || "/", `http://localhost:${port}`).pathname;
  if (!["/offline-pos.html", "/offline-pos.js", "/offline-pos-sw.js"].includes(path)) {
    response.writeHead(404); response.end(); return;
  }
  try {
    const body = await readFile(resolve(root, path.slice(1)));
    response.writeHead(200, { "content-type": contentTypes[path.slice(path.lastIndexOf("."))], "cache-control": "no-store" });
    response.end(body);
  } catch { response.writeHead(500); response.end(); }
}).listen(port, "127.0.0.1", () => console.log(`Offline shell test server listening on ${port}`));
