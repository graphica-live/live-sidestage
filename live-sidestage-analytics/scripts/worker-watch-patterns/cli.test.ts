/**
 * CLI統合テスト（worker 再起動提案）
 * `tsx scripts/check-worker-restart-proposal.ts` を子プロセスとして実行
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const repoRoot = path.resolve(__dirname, "../../");
const cliEntryPath = path.resolve(repoRoot, "scripts", "check-worker-restart-proposal.ts");

function runCli(...args: string[]): { exitCode: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("npx", ["tsx", cliEntryPath, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const error = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      exitCode: error.status ?? 1,
      stdout: error.stdout?.toString() ?? "",
      stderr: error.stderr?.toString() ?? "",
    };
  }
}

function writeChangedFiles(lines: string[]): string {
  const filePath = path.join(os.tmpdir(), `worker-restart-cli-${Date.now()}.txt`);
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  return filePath;
}

describe("check-worker-restart-proposal CLI", () => {
  it("worker.ts 変更で WORKER_RESTART_RECOMMENDED を出し exit 0", () => {
    const changedFilesPath = writeChangedFiles(["live-sidestage-analytics/worker.ts"]);
    const result = runCli(`--changed-files=${changedFilesPath}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("WORKER_RESTART_RECOMMENDED");
    expect(result.stdout).toContain("live-sidestage-analytics/worker.ts");
  }, 60_000);

  it("無関係パスのみで WORKER_RESTART_NOT_NEEDED を出し exit 0", () => {
    const changedFilesPath = writeChangedFiles([
      "live-sidestage-analytics/src/app/page.tsx",
    ]);
    const result = runCli(`--changed-files=${changedFilesPath}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("WORKER_RESTART_NOT_NEEDED");
    expect(result.stdout).not.toContain("WORKER_RESTART_RECOMMENDED");
  }, 60_000);

  it("prisma path still recommends restart", () => {
    const changedFilesPath = writeChangedFiles([
      "live-sidestage-analytics/prisma/schema.prisma",
    ]);
    const result = runCli(`--changed-files=${changedFilesPath}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("WORKER_RESTART_RECOMMENDED");
    expect(result.stdout).toContain("live-sidestage-analytics/prisma/schema.prisma");
  }, 60_000);


  it("battle-replay.ts 単独変更で WORKER_RESTART_GRAPH_ONLY（RECOMMENDED なし）", () => {
    const changedFilesPath = writeChangedFiles([
      "live-sidestage-analytics/src/lib/battle-replay.ts",
    ]);
    const result = runCli(`--changed-files=${changedFilesPath}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("WORKER_RESTART_GRAPH_ONLY");
    expect(result.stdout).toContain("live-sidestage-analytics/src/lib/battle-replay.ts");
    expect(result.stdout).not.toContain("WORKER_RESTART_RECOMMENDED");
    expect(result.stdout).not.toContain("::notice title=Worker restart recommended");
  }, 60_000);

  it("battle-replay.ts と worker.ts 同時変更では RECOMMENDED 優先", () => {
    const changedFilesPath = writeChangedFiles([
      "live-sidestage-analytics/src/lib/battle-replay.ts",
      "live-sidestage-analytics/worker.ts",
    ]);
    const result = runCli(`--changed-files=${changedFilesPath}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.startsWith("WORKER_RESTART_RECOMMENDED")).toBe(true);
    expect(result.stdout).toContain("live-sidestage-analytics/worker.ts");
    expect(result.stdout).not.toMatch(/^WORKER_RESTART_GRAPH_ONLY/m);
  }, 60_000);

  it("NOT_NEEDED 時に GRAPH_ONLY を出さない", () => {
    const changedFilesPath = writeChangedFiles([
      "live-sidestage-analytics/src/app/page.tsx",
    ]);
    const result = runCli(`--changed-files=${changedFilesPath}`);

    expect(result.stdout).not.toContain("WORKER_RESTART_GRAPH_ONLY");
  }, 60_000);

});
