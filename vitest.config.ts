import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@/lib/db": fileURLToPath(new URL("./src/lib/db-node.ts", import.meta.url)),
      "@/generated/prisma/client": fileURLToPath(new URL("./src/generated/prisma-node/client.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
