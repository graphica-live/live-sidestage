import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Dockerfile の CMD は web(LiveAnalytics サービス)の既定起動列。
 * ここが壊れても vitest / typecheck / next build は一切気付かないため、
 * 内容そのものを走査して守る。
 */
function startupChain(): string[] {
  const dockerfile = readFileSync(join(__dirname, "..", "Dockerfile"), "utf8");
  const cmdLine = dockerfile.split(/\r?\n/).find((l) => l.startsWith("CMD "));
  if (!cmdLine) throw new Error("Dockerfile に CMD 行が無い");

  const argv = JSON.parse(cmdLine.slice("CMD ".length)) as string[];
  expect(argv.slice(0, 2)).toEqual(["sh", "-c"]);
  return argv[2].split("&&").map((s) => s.trim());
}

describe("Dockerfile の起動列", () => {
  it("cutover 済みの migrate-tiktok-userid-reset.ts を実行しない", () => {
    // 旧形の列名が将来のスキーマ変更で偶然復活すると本番の全テーブルを
    // TRUNCATE する(scripts/migrate-tiktok-userid-reset.ts 冒頭のコメント)。
    // 2026-09-09 の本番 cutover 完了をもって起動列から外した。戻さない。
    expect(startupChain().join(" && ")).not.toContain("migrate-tiktok-userid-reset");
  });

  it("マイグレーション → db push → 後処理 → server.js の順序を保つ", () => {
    const chain = startupChain();
    const idx = (needle: string) => chain.findIndex((s) => s.includes(needle));

    // migrate-match-session は旧形検出型なので db push でスキーマが進む前に走る必要がある。
    expect(idx("migrate-match-session.ts")).toBeGreaterThanOrEqual(0);
    expect(idx("migrate-match-session.ts")).toBeLessThan(idx("prisma db push"));

    // migrate-match-battle-candidates は新スキーマ前提なので db push の後。
    expect(idx("migrate-match-battle-candidates.ts")).toBeGreaterThan(idx("prisma db push"));

    // server.js は必ず最後(前段が失敗したら起動させない)。
    expect(idx("node server.js")).toBe(chain.length - 1);
  });
});
