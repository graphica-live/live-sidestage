#!/usr/bin/env node
/**
 * Cron イメージ再デプロイ判定 CLI（cron import graph ∩ 変更ファイル）
 *
 * Usage:
 *   npx tsx scripts/check-cron-image-deploy.ts [--base=origin/main] [--head=HEAD]
 *   npx tsx scripts/check-cron-image-deploy.ts --changed-files=paths.txt
 *
 * Exit codes:
 *   0: 判定成功（NEEDED / NOT_NEEDED どちらも）
 *   1: import graph 不能、または git diff 失敗
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildImportGraph,
  buildCronExpectedPatterns,
  intersectChangedWithExpected,
  CRON_ENTRY_FILES,
} from "./worker-watch-patterns/core";

const NEEDED = "CRON_IMAGE_DEPLOY_NEEDED";
const NOT_NEEDED = "CRON_IMAGE_DEPLOY_NOT_NEEDED";

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
      headRef = arg.slice("--head=".length);
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
  const diffOutput = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMRD", `${baseRef}...${headRef}`],
    { cwd: monorepoRoot, encoding: "utf8", windowsHide: true }
  ).trim();

  if (!diffOutput) {
    return [];
  }

  return diffOutput.split("\n").filter((line) => line.length > 0);
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

function writeGithubOutput(needed: boolean): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  fs.appendFileSync(outputPath, `cron_image_deploy=${needed ? "true" : "false"}\n`, "utf8");
}

function emitNeeded(hits: string[]): void {
  console.log(NEEDED);
  for (const hit of hits) {
    console.log(hit);
  }

  if (process.env.GITHUB_ACTIONS === "true") {
    const paths = hits.join(", ");
    console.log(`::notice title=Cron image deploy needed::${paths}`);
  }

  appendGithubStepSummary(
    "## Cron イメージ再デプロイ\n\n" +
      "変更が cron の import graph に交差するため、GHCR イメージを cron サービスへ `serviceConnect` する。\n\n" +
      hits.map((h) => `- \`${h}\``).join("\n") +
      "\n"
  );
  writeGithubOutput(true);
}

function emitNotNeeded(): void {
  console.log(NOT_NEEDED);
  appendGithubStepSummary(
    "## Cron イメージ再デプロイ\n\ncron サービスは更新しない（変更が import graph の対象外）。\n"
  );
  writeGithubOutput(false);
}

async function main(): Promise<number> {
  const { baseRef, headRef, changedFilesPath } = parseArgs(process.argv.slice(2));

  const analyticsRoot = path.resolve(__dirname, "..");
  const monorepoRoot = path.resolve(analyticsRoot, "..");
  const srcDir = path.resolve(analyticsRoot, "src", "lib");
  const roots = CRON_ENTRY_FILES.map((file) => path.resolve(analyticsRoot, file));

  const graphResult = buildImportGraph({
    rootDir: analyticsRoot,
    srcDir,
    roots,
  });

  if (graphResult.unresolved.length > 0) {
    console.error(`Unresolved cron imports (${graphResult.unresolved.length}):`);
    for (const entry of graphResult.unresolved) {
      console.error(`  ${entry}`);
    }
    throw new Error("cron import graph has unresolved imports; refusing to skip or deploy");
  }

  if (graphResult.outsideSrcDir.length > 0) {
    console.error(`Cron imports outside src/lib (${graphResult.outsideSrcDir.length}):`);
    for (const entry of graphResult.outsideSrcDir) {
      console.error(`  ${entry}`);
    }
    throw new Error("cron import graph leaves src/lib; refusing to skip or deploy");
  }

  const expected = buildCronExpectedPatterns(graphResult.libFiles);

  const changedFiles = changedFilesPath
    ? loadChangedFilesFromPath(path.resolve(changedFilesPath))
    : getChangedFilesFromGit(monorepoRoot, baseRef, headRef);

  const hits = intersectChangedWithExpected(changedFiles, expected);

  if (hits.length > 0) {
    emitNeeded(hits);
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