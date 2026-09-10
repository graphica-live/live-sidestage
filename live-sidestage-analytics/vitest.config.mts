import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // tsconfig.json は Next.js の SWC ビルド前提で jsx: "preserve" になっているため、
  // Vite(oxc)側で明示的に自動変換を指定しないと .tsx を import しただけで構文エラーになる。
  // Vite の OxcOptions 型定義に "automatic" が含まれていないため any でキャストする(実行時には正しく動作する)。
  oxc: {
    jsx: "automatic",
  } as any,
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
