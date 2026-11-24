import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": path.join(root, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    env: {
      // A throwaway key store, never the app's data/ folder.
      API_KEY_DATA_FILE: path.join(os.tmpdir(), `dashboard-test-keys-${process.pid}.json`),
      API_KEY_PEPPER: "test-pepper",
    },
  },
});
