/**
 * CLI 統合テスト（cron イメージ再デプロイ判定）
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  buildCronExpectedPatterns,
  CRON_ENTRY_FILES,
  COMMON_WATCH_PATTERNS,
} from "./core";

const repoRoot = path.resolve(__dirname, "../../");
const cliEntryPath = path.resolve(repoRoot, "scripts", "check-cron-image-deploy.ts");

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
    const error = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: error.status ?? 1,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
    };
  }
}

function writeChangedFiles(lines: string[]): string {
  const filePath = path.join(os.tmpdir(), `cron-image-deploy-cli-${Date.now()}-${Math.random()}.txt`);
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  return filePath;
}

describe("buildCronExpectedPatterns", () => {
  it("worker.ts を含めず cron エントリを含める", () => {
    const expected = buildCronExpectedPatterns(["gift-retention.ts"]);
    expect(expected.has("live-sidestage-analytics/worker.ts")).toBe(false);
    expect(COMMON_WATCH_PATTERNS).toContain("worker.ts");
    for (const entry of CRON_ENTRY_FILES) {
      expect(expected.has(`live-sidestage-analytics/${entry}`)).toBe(true);
    }
    expect(expected.has("live-sidestage-analytics/src/lib/gift-retention.ts")).toBe(true);
    expect(expected.has("live-sidestage-analytics/prisma/**")).toBe(true);
  });
});

describe("check-cron-image-deploy CLI", () => {
  it("gift-retention.ts 変更で CRON_IMAGE_DEPLOY_NEEDED を出し exit 0", () => {
    const changedFilesPath = writeChangedFiles(["live-sidestage-analytics/gift-retention.ts"]);
    const result = runCli(`--changed-files=${changedFilesPath}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CRON_IMAGE_DEPLOY_NEEDED");
    expect(result.stdout).toContain("live-sidestage-analytics/gift-retention.ts");
  }, 60_000);

  it("web ページのみで CRON_IMAGE_DEPLOY_NOT_NEEDED を出し exit 0", () => {
    const changedFilesPath = writeChangedFiles([
      "live-sidestage-analytics/src/app/page.tsx",
    ]);
    const result = runCli(`--changed-files=${changedFilesPath}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CRON_IMAGE_DEPLOY_NOT_NEEDED");
    expect(result.stdout).not.toContain("CRON_IMAGE_DEPLOY_NEEDED");
  }, 60_000);

  it("worker.ts のみでは cron を更新しない", () => {
    const changedFilesPath = writeChangedFiles(["live-sidestage-analytics/worker.ts"]);
    const result = runCli(`--changed-files=${changedFilesPath}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CRON_IMAGE_DEPLOY_NOT_NEEDED");
  }, 60_000);

  it("prisma 変更では cron を更新する", () => {
    const changedFilesPath = writeChangedFiles([
      "live-sidestage-analytics/prisma/schema.prisma",
    ]);
    const result = runCli(`--changed-files=${changedFilesPath}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CRON_IMAGE_DEPLOY_NEEDED");
  }, 60_000);

  it("git diff 失敗時は exit 1", () => {
    const result = runCli("--base=definitely-not-a-ref", "--head=HEAD");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain("CRON_IMAGE_DEPLOY_NOT_NEEDED");
  }, 60_000);
  it("推移的 src/lib 依存の変更でも NEEDED", () => {
    const changedFilesPath = writeChangedFiles([
      "live-sidestage-analytics/src/lib/gift-retention-window.ts",
    ]);
    const result = runCli(`--changed-files=${changedFilesPath}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CRON_IMAGE_DEPLOY_NEEDED");
  }, 60_000);

  it("GITHUB_OUTPUT に cron_image_deploy=true を書く", () => {
    const changedFilesPath = writeChangedFiles(["live-sidestage-analytics/gift-retention.ts"]);
    const outputPath = path.join(os.tmpdir(), `cron-gha-out-${Date.now()}.txt`);
    const stdout = execFileSync("npx", ["tsx", cliEntryPath, `--changed-files=${changedFilesPath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: outputPath },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    expect(stdout).toContain("CRON_IMAGE_DEPLOY_NEEDED");
    const output = fs.readFileSync(outputPath, "utf8");
    expect(output).toContain("cron_image_deploy=true");
  }, 60_000);

  it("workflow が path hit / skip / cutover / 空ID を分岐する", () => {
    const wf = fs.readFileSync(
      path.resolve(repoRoot, "..", ".github", "workflows", "analytics-ci.yml"),
      "utf8"
    );
    expect(wf).toContain("CRON_IMAGE_DEPLOY");
    expect(wf).toContain("cron cutover from GitHub source");
    expect(wf).toContain("cron skip (image source, no path hit)");
    expect(wf).toContain("no cron services configured, skipping cron deploy");
    expect(wf).toContain("RAILWAY_ANALYTICS_CRON_SERVICE_IDS");
  });
});
