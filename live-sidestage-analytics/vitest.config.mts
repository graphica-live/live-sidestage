import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    // scripts/ も対象にする。移行スクリプト(scripts/migrate-*.ts)は本番の起動時に
    // DDL と TRUNCATE を実行するので、実DBに対する統合テストを持たせる。
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
});
