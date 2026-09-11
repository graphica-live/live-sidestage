/**
 * CLI: worker watchPatterns ドリフト検知
 * 使用例:
 *   npm run check:worker-watch-patterns
 *   npm run check:worker-watch-patterns --mock-railway __fixtures__/watchpatterns-snapshot.json
 *   npm run check:worker-watch-patterns --extra-root /path/to/new/file.ts
 */

import fs from "node:fs";
import path from "node:path";
import { buildImportGraph, buildExpectedPatterns, diffPatterns, COMMON_WATCH_PATTERNS } from "./worker-watch-patterns/core";
import { getRailwayContext, getAccessToken, fetchWatchPatterns } from "./worker-watch-patterns/railway-client";

async function main() {
  // 引数解析
  const args = process.argv.slice(2);
  let mockRailwayPath: string | undefined;
  const extraRoots: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mock-railway" && i + 1 < args.length) {
      mockRailwayPath = args[i + 1];
      i++;
    } else if (args[i] === "--extra-root" && i + 1 < args.length) {
      extraRoots.push(args[i + 1]);
      i++;
    }
  }

  const repoRoot = path.resolve(__dirname, "../");
  const srcDir = path.resolve(repoRoot, "src", "lib");
  const workerPath = path.resolve(repoRoot, "worker.ts");
  const tiktokListenerPath = path.resolve(srcDir, "tiktok-listener.ts");

  // buildImportGraph
  console.log("Scanning import graph...");
  const roots = [workerPath, tiktokListenerPath, ...extraRoots];
  const graphResult = buildImportGraph({
    rootDir: repoRoot,
    srcDir,
    roots,
  });

  if (graphResult.unresolved.length > 0) {
    console.warn(`⚠️  ${graphResult.unresolved.length} unresolved imports:`);
    graphResult.unresolved.forEach((u) => console.warn(`   ${u}`));
  }

  // 期待値生成
  console.log(`Found ${graphResult.libFiles.length} lib files`);
  const expected = buildExpectedPatterns(graphResult.libFiles);
  console.log(`Expected patterns: ${expected.size} items (${COMMON_WATCH_PATTERNS.length} common + ${graphResult.libFiles.length} lib files)`);

  // Railway実値取得
  let actual: Record<"worker1" | "worker2" | "worker3", string[]>;

  if (mockRailwayPath) {
    console.log(`Loading mock Railway data from ${mockRailwayPath}...`);
    try {
      const mockContent = fs.readFileSync(mockRailwayPath, "utf8");
      const parsed = JSON.parse(mockContent);
      for (const key of ["worker1", "worker2", "worker3"] as const) {
        if (!Array.isArray(parsed?.[key])) {
          throw new Error(`mock railway data missing array field "${key}"`);
        }
      }
      actual = parsed;
    } catch (err) {
      console.error(`Failed to load mock Railway data: ${err instanceof Error ? err.message : "unknown error"}`);
      process.exitCode = 1;
      return;
    }
  } else {
    console.log("Connecting to Railway...");
    try {
      const context = getRailwayContext(repoRoot);
      const token = getAccessToken();
      actual = await fetchWatchPatterns(context.environmentId, token, context.serviceIds);
      console.log(`Fetched watchPatterns for worker1, worker2, worker3`);
    } catch (err) {
      console.error(`Railway API error: ${err instanceof Error ? err.message : "unknown error"}`);
      process.exitCode = 1;
      return;
    }
  }

  // 差分計算
  console.log("\n=== Results ===\n");

  const diffs = {
    worker1: diffPatterns(expected, actual.worker1),
    worker2: diffPatterns(expected, actual.worker2),
    worker3: diffPatterns(expected, actual.worker3),
  };

  let hasIssue = false;
  let hasUnresolved = graphResult.unresolved.length > 0;

  for (const [name, diff] of Object.entries(diffs)) {
    if (diff.missing.length > 0 || diff.extra.length > 0) {
      hasIssue = true;
      console.log(`${name}:`);
      if (diff.missing.length > 0) {
        console.log(`  Missing (${diff.missing.length} items):`);
        diff.missing.forEach((p) => console.log(`    - ${p}`));
      }
      if (diff.extra.length > 0) {
        console.log(`  Extra (${diff.extra.length} items):`);
        diff.extra.forEach((p) => console.log(`    - ${p}`));
      }
      console.log();
    }
  }

  // worker1/2/3間の不一致チェック
  const workerArrays = {
    worker1: actual.worker1,
    worker2: actual.worker2,
    worker3: actual.worker3,
  };

  const worker1Set = new Set(actual.worker1);
  const worker2Set = new Set(actual.worker2);
  const worker3Set = new Set(actual.worker3);

  const mismatchBetweenWorkers = !setsEqual(worker1Set, worker2Set) || !setsEqual(worker2Set, worker3Set);
  if (mismatchBetweenWorkers) {
    hasIssue = true;
    console.log("⚠️  Mismatch detected between worker services:");
    const diff12 = diffSets(worker1Set, worker2Set);
    if (diff12.missing.length > 0 || diff12.extra.length > 0) {
      console.log(`  worker1 vs worker2:`);
      if (diff12.missing.length > 0) console.log(`    worker2にあるがworker1に無い: ${diff12.missing.join(", ")}`);
      if (diff12.extra.length > 0) console.log(`    worker1にあるがworker2に無い: ${diff12.extra.join(", ")}`);
    }

    const diff23 = diffSets(worker2Set, worker3Set);
    if (diff23.missing.length > 0 || diff23.extra.length > 0) {
      console.log(`  worker2 vs worker3:`);
      if (diff23.missing.length > 0) console.log(`    worker3にあるがworker2に無い: ${diff23.missing.join(", ")}`);
      if (diff23.extra.length > 0) console.log(`    worker2にあるがworker3に無い: ${diff23.extra.join(", ")}`);
    }
    console.log();
  }

  // 結果サマリ
  if (hasIssue || hasUnresolved) {
    console.log(`❌ DRIFT DETECTED`);
    if (hasIssue) console.log(`   - watchPatterns mismatch found`);
    if (hasUnresolved) console.log(`   - unresolved imports found`);
    process.exitCode = 1;
  } else {
    console.log(`✓ All checks passed. worker1/2/3 are in sync.`);
    process.exitCode = 0;
  }
}

// ユーティリティ関数
function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

function diffSets<T>(a: Set<T>, b: Set<T>): { missing: T[]; extra: T[] } {
  return {
    missing: Array.from(b).filter((item) => !a.has(item)),
    extra: Array.from(a).filter((item) => !b.has(item)),
  };
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
