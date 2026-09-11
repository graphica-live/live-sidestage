import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Dockerfile の CMD は web(LiveAnalytics サービス)の既定起動列。
 * ここが壊れても vitest / typecheck / next build は一切気付かないため、
 * 内容そのものを走査して守る。
 *
 * 2026-09-11: prisma db push --accept-data-loss を CMD から除去し、
 * スキーマ反映は Railway Pre-Deploy Command(`npm run predeploy:web`)へ分離した
 * (docs/deploy/prisma-migration-runbook.md 参照)。CMD は起動のみを担う。
 */
function startupChain(): string[] {
  const dockerfile = readFileSync(join(__dirname, "..", "Dockerfile"), "utf8");
  const cmdLine = dockerfile.split(/\r?\n/).find((l) => l.startsWith("CMD "));
  if (!cmdLine) throw new Error("Dockerfile に CMD 行が無い");

  const argv = JSON.parse(cmdLine.slice("CMD ".length)) as string[];
  expect(argv.slice(0, 2)).toEqual(["sh", "-c"]);
  return argv[2].split("&&").map((s) => s.trim());
}

function readPackageJson(): { scripts: Record<string, string> } {
  const raw = readFileSync(join(__dirname, "..", "package.json"), "utf8");
  return JSON.parse(raw) as { scripts: Record<string, string> };
}

describe("Dockerfile の起動列", () => {
  it("cutover 済みの migrate-tiktok-userid-reset.ts を実行しない", () => {
    // 旧形の列名が将来のスキーマ変更で偶然復活すると本番の全テーブルを
    // TRUNCATE する(scripts/migrate-tiktok-userid-reset.ts 冒頭のコメント)。
    // 2026-09-09 の本番 cutover 完了をもって起動列から外した。戻さない。
    expect(startupChain().join(" && ")).not.toContain("migrate-tiktok-userid-reset");
  });

  it("CMD は node server.js のみで、migration系コマンドを含まない", () => {
    // prisma db push --accept-data-loss / migrate-match-session.ts /
    // migrate-match-battle-candidates.ts は Railway Pre-Deploy Command
    // (predeploy:web script)へ移した。CMD に戻すと6サービス共有の起動経路へ
    // 破壊的な db push が復活してしまう。
    const chain = startupChain();
    expect(chain).toEqual([
      'echo "[startup] PORT=$PORT"',
      "node server.js",
    ]);
  });

  it("CMD に prisma db push を含まない", () => {
    expect(startupChain().join(" && ")).not.toContain("prisma db push");
  });
});

describe("predeploy:web script の実行順序", () => {
  it("session backfill → migrate deploy → candidates backfill の順で呼ぶ", () => {
    const { scripts } = readPackageJson();
    const predeploy = scripts["predeploy:web"];
    expect(predeploy).toBeTruthy();

    const chain = predeploy.split("&&").map((s) => s.trim());
    const idx = (needle: string) => chain.findIndex((s) => s.includes(needle));

    // migrate-match-session は旧形検出型なので migrate deploy でスキーマが進む前に走る必要がある。
    expect(idx("migrate-match-session.ts")).toBeGreaterThanOrEqual(0);
    expect(idx("migrate-match-session.ts")).toBeLessThan(idx("prisma migrate deploy"));

    // migrate-match-battle-candidates は新スキーマ前提なので migrate deploy の後。
    expect(idx("prisma migrate deploy")).toBeGreaterThanOrEqual(0);
    expect(idx("migrate-match-battle-candidates.ts")).toBeGreaterThan(idx("prisma migrate deploy"));
  });

  it("db push を使わない(migrate deploy に一本化されている)", () => {
    const { scripts } = readPackageJson();
    expect(scripts["predeploy:web"]).not.toContain("db push");
  });
});

describe("db push --accept-data-loss の再混入防止(回帰テスト)", () => {
  it("package.json のどのscriptにも db push --accept-data-loss が含まれない", () => {
    const { scripts } = readPackageJson();
    for (const [name, cmd] of Object.entries(scripts)) {
      expect(cmd, `script "${name}" に db push --accept-data-loss が含まれている`).not.toContain(
        "db push --accept-data-loss",
      );
    }
  });

  it("build script が db push を含まない", () => {
    const { scripts } = readPackageJson();
    expect(scripts.build).not.toContain("db push");
  });

  it("analytics-ci.yml (モノレポルート) に db push --accept-data-loss が含まれない", () => {
    // モノレポルート: live-sidestage-analytics/.. /../.github/workflows/analytics-ci.yml
    const workflowPath = join(
      __dirname,
      "..",
      "..",
      ".github",
      "workflows",
      "analytics-ci.yml",
    );
    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).not.toContain("db push --accept-data-loss");
  });
});
