// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// tiktok-user.test.ts が fake db で固定しているのは「どんな upsert 引数を組み立てるか」まで。
// ここは**実 Postgres に対して**、plan §2.1 の前提条件そのものを検証する:
//  - 外側のトランザクションが rollback したら tiktok_users 行も残らない(同一トランザクション性)
//  - commit したら必ず対応行がある
//  - 表示名を欠く観測が既知の名前を潰さない(last-write-wins だが null では潰さない)
//  - resolveTikTokUserDisplay() が uid から順引きでき、行の無い uid は返さない
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "./prisma";
import {
  recordTikTokUser,
  resolveTikTokUserDisplay,
  resetTikTokUserThrottleForTest,
} from "./tiktok-user";

// 他ファイルと衝突しない uid 空間を使う(このファイル専用の prefix + 連番)。
let seq = 0;
function freshUid(): string {
  seq += 1;
  return `9${String(Date.now()).slice(-11)}${String(seq).padStart(4, "0")}`;
}

const created: string[] = [];
function track(uid: string): string {
  created.push(uid);
  return uid;
}

beforeEach(() => {
  // プロセス内スロットルは同一プロセスの他テストと共有される。毎回空にする。
  resetTikTokUserThrottleForTest();
});

afterAll(async () => {
  if (created.length > 0) {
    await prisma.tikTokUser.deleteMany({ where: { tiktokUid: { in: created } } });
  }
  await prisma.$disconnect();
});

describe("recordTikTokUser() の同一トランザクション性", () => {
  it("外側のトランザクションが rollback すると tiktok_users 行も残らない", async () => {
    const tiktokUid = track(freshUid());

    await expect(
      prisma.$transaction(async (tx) => {
        await recordTikTokUser(tx, { tiktokUid, tiktokHandle: "rollback_case", nickname: "ロール" });
        throw new Error("rollback");
      })
    ).rejects.toThrow("rollback");

    expect(await prisma.tikTokUser.findUnique({ where: { tiktokUid } })).toBeNull();
  });

  it("rollback したあとの再観測はスロットルで飛ばされない(marker が立っていない)", async () => {
    const tiktokUid = track(freshUid());

    await prisma
      .$transaction(async (tx) => {
        // commit コールバックを呼ばずに rollback する = marker を立てない。
        await recordTikTokUser(tx, { tiktokUid, tiktokHandle: "retry_case" });
        throw new Error("rollback");
      })
      .catch(() => {});

    const commit = await prisma.$transaction(async (tx) =>
      recordTikTokUser(tx, { tiktokUid, tiktokHandle: "retry_case" })
    );
    commit();

    const row = await prisma.tikTokUser.findUnique({ where: { tiktokUid } });
    expect(row?.tiktokHandle).toBe("retry_case");
  });

  it("commit すれば必ず対応行がある", async () => {
    const tiktokUid = track(freshUid());

    const commit = await prisma.$transaction(async (tx) =>
      recordTikTokUser(tx, { tiktokUid, tiktokHandle: "commit_case", nickname: "コミット" })
    );
    commit();

    const row = await prisma.tikTokUser.findUnique({ where: { tiktokUid } });
    expect(row).not.toBeNull();
    expect(row?.tiktokHandle).toBe("commit_case");
    expect(row?.nickname).toBe("コミット");
  });
});

describe("表示名の last-write-wins は null で潰さない", () => {
  it("表示名を欠く後続観測が既知の tiktokHandle / nickname を残す", async () => {
    const tiktokUid = track(freshUid());

    (await recordTikTokUser(prisma, { tiktokUid, tiktokHandle: "known", nickname: "既知" }))();
    // TLC の変換は空の uniqueId / nickname を undefined にする。その観測を模す。
    (await recordTikTokUser(prisma, { tiktokUid, tiktokHandle: undefined, nickname: undefined }))();

    const row = await prisma.tikTokUser.findUnique({ where: { tiktokUid } });
    expect(row?.tiktokHandle).toBe("known");
    expect(row?.nickname).toBe("既知");
  });

  it("非 null の新しい値は上書きする(改名の追随)", async () => {
    const tiktokUid = track(freshUid());

    (await recordTikTokUser(prisma, { tiktokUid, tiktokHandle: "before", nickname: "旧" }))();
    (await recordTikTokUser(prisma, { tiktokUid, tiktokHandle: "after" }))();

    const row = await prisma.tikTokUser.findUnique({ where: { tiktokUid } });
    expect(row?.tiktokHandle).toBe("after");
    // nickname は観測されていないので既知値のまま。
    expect(row?.nickname).toBe("旧");
  });

  it("同じ観測値の2回目はスロットルで upsert されない", async () => {
    const tiktokUid = track(freshUid());

    (await recordTikTokUser(prisma, { tiktokUid, tiktokHandle: "throttled", nickname: "n" }))();
    const first = await prisma.tikTokUser.findUniqueOrThrow({ where: { tiktokUid } });

    // DB を直接書き換えてから同じ観測値を流す。upsert が走れば戻るはずが、走らないので残る。
    await prisma.tikTokUser.update({ where: { tiktokUid }, data: { nickname: "手で変えた" } });
    (await recordTikTokUser(prisma, { tiktokUid, tiktokHandle: "throttled", nickname: "n" }))();

    const after = await prisma.tikTokUser.findUniqueOrThrow({ where: { tiktokUid } });
    expect(after.nickname).toBe("手で変えた");
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime());
  });
});

describe("resolveTikTokUserDisplay()", () => {
  it("uid から順引きでき、行の無い uid はマップに現れない", async () => {
    const present = track(freshUid());
    const absent = track(freshUid());
    (await recordTikTokUser(prisma, { tiktokUid: present, tiktokHandle: "lookup", nickname: "参照" }))();

    const map = await resolveTikTokUserDisplay([present, absent, present, ""]);

    expect(map.get(present)).toEqual({
      tiktokUid: present,
      tiktokHandle: "lookup",
      nickname: "参照",
    });
    expect(map.has(absent)).toBe(false);
    expect(map.size).toBe(1);
  });

  it("空の入力では DB を引かずに空マップを返す", async () => {
    expect((await resolveTikTokUserDisplay([])).size).toBe(0);
    expect((await resolveTikTokUserDisplay([""])).size).toBe(0);
  });
});
