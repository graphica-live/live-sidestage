// prisma.tikTokUser の出現を src/lib/tiktok-user.ts 1ファイルへ閉じ込める規律をソース走査で固定する。
//
// TikTokUser は「tiktokUid → 表示名」の順引き専用で、ハンドルからの逆引きに使ってはいけない。
// アクセサを1箇所に集めておかないと、この規律が守られているかを機械検査できない。

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC_ROOT = join(process.cwd(), "src");
const ALLOWED = new Set(["lib/tiktok-user.ts"]);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("prisma.tikTokUser アクセサの集約", () => {
  it("src/lib/tiktok-user.ts 以外から prisma.tikTokUser を触らない", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file).split(sep).join("/");
      if (ALLOWED.has(rel)) continue;
      // テストは対象外。規律の目的は本番コードから逆引きの余地を無くすことで、
      // テストが tiktok_users へ直接行を用意するのは前提条件の準備でしかない。
      if (/\.test\.tsx?$/.test(rel)) continue;
      const source = readFileSync(file, "utf8");
      if (/\bprisma\.tikTokUser\b/.test(source) || /\btx\.tikTokUser\b/.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
