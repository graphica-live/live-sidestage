#!/usr/bin/env node
/**
 * TikTok worker 再起動提案 CLI（import graph ∩ 変更ファイル）
 *
 * Usage:
 *   npx tsx scripts/check-worker-restart-proposal.ts [--base=origin/main] [--head=HEAD]
 *   npx tsx scripts/check-worker-restart-proposal.ts --changed-files=paths.txt
 *
 * Exit codes:
 *   0: 提案の有無に関わらず正常終了（git 失敗時も fail-open）
 *   1: import graph など起動不能な致命エラー
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildImportGraph,
  buildExpectedPatterns,
  intersectChangedWithExpected,
} from "./worker-watch-patterns/core";

const RECOMMENDED = "WORKER_RESTART_RECOMMENDED";
const NOT_NEEDED = "WORKER_RESTART_NOT_NEEDED";

function parseArgs(argv: string[]): {
  baseRef: string;
  headRef: string;
  changedFilesPath?: string;
} {
  let baseRef = "origin/main";
  let headRef = "HEAD";
  let changedFilesPath: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--base=")) {
      baseRef = arg.slice(7);
    } else if (arg.startsWith("--head=")) {
      headRef = arg.slice(7);
    } else if (arg.startsWith("--changed-files=")) {
      changedFilesPath = arg.slice("--changed-files=".length);
    }
  }

  return { baseRef, headRef, changedFilesPath };
}

function getChangedFilesFromGit(
  monorepoRoot: string,
  baseRef: string,
  headRef: string
): string[] {
  try {
    const diffOutput = execSync(
      `git diff --name-only --diff-filter=ACMR ${baseRef}...${headRef}`,
      { cwd: monorepoRoot, encoding: "utf8" }
    ).trim();

    if (!diffOutput) {
      return [];
    }

    return diffOutput.split("\n").filter((line) => line.length > 0);
  } catch (error) {
    console.warn(
      `Warning: git diff failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

function loadChangedFilesFromPath(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function appendGithubStepSummary(markdown: string): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  fs.appendFileSync(summaryPath, markdown, "utf8");
}

function emitRecommendation(hits: string[]): void {
  console.log(RECOMMENDED);
  for (const hit of hits) {
    console.log(hit);
  }

  if (process.env.GITHUB_ACTIONS === "true") {
    const paths = hits.join(", ");
    console.log(`::notice title=Worker restart recommended::${paths}`);
  }

  appendGithubStepSummary(
    "## TikTok worker 再起動提案\n\n" +
      "**worker1 / worker2 / worker3 の手動再起動を検討してください。**\n\n" +
      hits.map((h) => `- \`${h}\``).join("\n") +
      "\n"
  );
}

function emitNotNeeded(): void {
  console.log(NOT_NEEDED);
  appendGithubStepSummary(
    "## TikTok worker 再起動提案\n\n再起動は不要です（変更が import graph の対象外）。\n"
  );
}

async function main(): Promise<number> {
  const { baseRef, headRef, changedFilesPath } = parseArgs(process.argv.slice(2));

  const analyticsRoot = path.resolve(__dirname, "..");
  const monorepoRoot = path.resolve(analyticsRoot, "..");
  const srcDir = path.resolve(analyticsRoot, "src", "lib");
  const workerPath = path.resolve(analyticsRoot, "worker.ts");
  const tiktokListenerPath = path.resolve(srcDir, "tiktok-listener.ts");

  const graphResult = buildImportGraph({
    rootDir: analyticsRoot,
    srcDir,
    roots: [workerPath, tiktokListenerPath],
  });

  if (graphResult.unresolved.length > 0) {
    console.warn(`Warning: ${graphResult.unresolved.length} unresolved imports:`);
    for (const entry of graphResult.unresolved) {
      console.warn(`  ${entry}`);
    }
  }

  const expected = buildExpectedPatterns(graphResult.libFiles);

  const changedFiles = changedFilesPath
    ? loadChangedFilesFromPath(path.resolve(changedFilesPath))
    : getChangedFilesFromGit(monorepoRoot, baseRef, headRef);

  const hits = intersectChangedWithExpected(changedFiles, expected);

  if (hits.length > 0) {
    emitRecommendation(hits);
  } else {
    emitNotNeeded();
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });