// prisma.tiktokRoom の create / upsert を src/lib/tiktok-room.ts 1ファイルへ閉じ込める規律を
// ソース走査で固定する。
//
// **不変条件: `TiktokRoom` を作って `TikTokUser` を作らない経路は存在してはならない。**
// 生観測系(Gift / ListenerComment / …)から表示用の列を全部落としたので、room の配信者に
// 対応する `tiktok_users` 行が無いと、バトル履歴も管理画面も表示名が全部 null になる。
// room 作成の入口が散っていると、この不変条件を数え漏らす(実際、旧稿の棚卸しは
// worker-status.ts の直書きを数え落としていた)。
//
// 同じ思想の guard: tiktok-user.guard.test.ts(prisma.tikTokUser の集約)。

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC_ROOT = join(process.cwd(), "src");
const ALLOWED = new Set(["lib/tiktok-room.ts"]);

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

describe("TiktokRoom 作成経路の集約", () => {
  it("src/lib/tiktok-room.ts 以外から prisma.tiktokRoom.create / upsert を呼ばない", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file).split(sep).join("/");
      if (ALLOWED.has(rel)) continue;
      // テストは対象外。room を直接用意するのは前提条件の準備でしかない。
      if (/\.test\.tsx?$/.test(rel)) continue;
      const source = readFileSync(file, "utf8");
      if (/\b(?:prisma|tx|client|db)\.tiktokRoom\.(?:create|upsert)\b/.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
