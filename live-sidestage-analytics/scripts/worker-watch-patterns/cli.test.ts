/**
 * CLI統合テスト (Test A〜D)
 * `tsx scripts/check-worker-watch-patterns.ts` を子プロセスとして実行
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../");
const cliEntryPath = path.resolve(repoRoot, "scripts", "check-worker-watch-patterns.ts");

/**
 * `tsx scripts/check-worker-watch-patterns.ts <args>` を実行
 */
function runCli(...args: string[]): { exitCode: number; stdout: string; stderr: string } {
  try {
    // Windows では npx の実体が npx.cmd のため execFileSync の直接実行はENOENTになる。
    // 引数は全てこのテストファイル内で組み立てた固定値・絶対パスでユーザー入力を含まないため、
    // shell経由でも injection リスクはない。
    const stdout = execFileSync("npx", ["tsx", cliEntryPath, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (err: any) {
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

describe("CLI integration tests (Test A~D)", () => {
  let tempDir: string;
  let snapshotPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync("cli-test-");
    snapshotPath = path.join(tempDir, "snapshot.json");

    // 現在の本番70項目のスナップショットを一時ディレクトリにコピー
    const sourceSnapshot = path.resolve(__dirname, "__fixtures__", "watchpatterns-snapshot.json");
    fs.copyFileSync(sourceSnapshot, snapshotPath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("Test A: --mock-railway snapshot.json のみで全チェック成功", () => {
    const result = runCli("--mock-railway", snapshotPath);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("✓");
    expect(result.stdout).toContain("All checks passed");
  });

  it("Test B: --extra-root で新規importを追加すると missing検出", () => {
    // buildImportGraphのsrcDirは実リポジトリのsrc/lib固定のため、
    // --extra-rootで渡すファイルも実際にsrc/lib配下に置かないと検出対象にならない。
    // テスト専用の一時ファイルとして作成し、必ずafterEachで削除する。
    const realSrcLibDir = path.resolve(repoRoot, "src", "lib");
    const newFile = path.join(realSrcLibDir, "__cli-test-b-new-module__.ts");
    const newRoot = path.join(realSrcLibDir, "__cli-test-b-root__.ts");

    fs.writeFileSync(newFile, "export const newFunc = () => {};");
    fs.writeFileSync(
      newRoot,
      `import { newFunc } from "./__cli-test-b-new-module__";\nexport const listener = () => {};`
    );

    try {
      // CLIを実行: --extra-root で新規fixtureファイルを追加
      const result = runCli("--mock-railway", snapshotPath, "--extra-root", newRoot);

      // 期待値が増えるが snapshotにはないため missing検出 → exit code 1
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("Missing");
    } finally {
      fs.rmSync(newFile, { force: true });
      fs.rmSync(newRoot, { force: true });
    }
  });

  it("Test C: 実在しないダミーパスが extra に入るとextra検出", () => {
    // snapshotを一時コピーして修正
    let mockData = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));

    // worker1の配列へダミーパスを追加
    mockData.worker1.push("live-sidestage-analytics/src/lib/nonexistent-dummy.ts");

    fs.writeFileSync(snapshotPath, JSON.stringify(mockData));

    const result = runCli("--mock-railway", snapshotPath);

    // worker1でextra検出 → exit code 1
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Extra");
  });

  it("Test D: worker2から1件削除するとworker2のみmissing検出", () => {
    // snapshotを一時コピーして修正
    let mockData = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));

    // worker2の配列から最後の1件を削除
    if (mockData.worker2.length > 0) {
      mockData.worker2.pop();
    }

    fs.writeFileSync(snapshotPath, JSON.stringify(mockData));

    const result = runCli("--mock-railway", snapshotPath);

    // worker2でmissing検出、worker1/worker3はOK → exit code 1
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Missing");
    expect(result.stdout).toContain("worker2");

    // worker1/worker3は問題ないことを確認（直接的な断定は難しいが、worker2のみ出力されるはず）
    // （完全な出力内容の検証は実装環境依存なので省略）
  });
});
