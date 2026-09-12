// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// TiktokRoomCollabSource の lifecycle(記録/解放/TTL cleanup/atomic conditional update)を
// 実DBで検証する。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ensureRoomWatchedForCollab } from "./tiktok-room";
import {
  recordCollabSourceLink,
  releaseCollabSourceLinksBySource,
  cleanupStaleCollabSourceLinks,
} from "./tiktok-collab-source";

const roomIds: string[] = [];
const tiktokUids: string[] = [];

let uidSeq = 0;

function makeSubject(tag: string) {
  uidSeq += 1;
  const rand = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  const tiktokUid = `7${String(Date.now() % 1_000_000).padStart(6, "0")}${rand}${String(uidSeq).padStart(5, "0")}`;
  tiktokUids.push(tiktokUid);
  return {
    tiktokUid,
    tiktokHandle: `itestcollabsrc${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase(),
    nickname: `itest ${tag}`,
  };
}

/**
 * テスト用にwatched roomを1つ用意する(ensureRoomWatchedForCollab経由。tiktok-room.guard.test.tsの
 * 規律のため)。ensureRoomWatchedForCollab()自体はTiktokRoomCollabSourceのリンクを作らない
 * (リンク作成は本番コードではwatchDiscoveredRooms()が別途recordCollabSourceLink()を呼ぶ)ため、
 * ここで明示的にリンクを張る。
 */
async function makeWatchedRoom(tag: string, sourceRoomId: string): Promise<string> {
  const result = await ensureRoomWatchedForCollab(makeSubject(tag), undefined, "collab", sourceRoomId);
  if (!result) throw new Error("ensureRoomWatchedForCollab returned null");
  roomIds.push(result.roomId);
  await recordCollabSourceLink(result.roomId, sourceRoomId);
  return result.roomId;
}

afterAll(async () => {
  await prisma.tiktokRoomCollabSource.deleteMany({ where: { watchedRoomId: { in: roomIds } } });
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
  await prisma.tikTokUser.deleteMany({ where: { tiktokUid: { in: tiktokUids } } });
});

describe("recordCollabSourceLink / releaseCollabSourceLinksBySource", () => {
  it("同じ発見元からの再検知はlastSeenAtを更新するだけで行を増やさない", async () => {
    const watchedRoomId = await makeWatchedRoom("upsert", "itest-source-upsert");

    await recordCollabSourceLink(watchedRoomId, "itest-source-upsert");
    const first = await prisma.tiktokRoomCollabSource.findUniqueOrThrow({
      where: { watchedRoomId_sourceRoomId: { watchedRoomId, sourceRoomId: "itest-source-upsert" } },
    });

    await new Promise((r) => setTimeout(r, 5));
    await recordCollabSourceLink(watchedRoomId, "itest-source-upsert");
    const second = await prisma.tiktokRoomCollabSource.findUniqueOrThrow({
      where: { watchedRoomId_sourceRoomId: { watchedRoomId, sourceRoomId: "itest-source-upsert" } },
    });

    expect(second.id).toBe(first.id);
    expect(second.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());

    const count = await prisma.tiktokRoomCollabSource.count({ where: { watchedRoomId } });
    expect(count).toBe(1);
  });

  it("複数の発見元から同時に発見されたroomは、片方が解散しても他方のリンクが残る限りlastWatchInstructedAtを倒さない", async () => {
    const watchedRoomId = await makeWatchedRoom("multi", "itest-source-multi-x");
    await recordCollabSourceLink(watchedRoomId, "itest-source-multi-y");

    const before = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: watchedRoomId } });

    await releaseCollabSourceLinksBySource("itest-source-multi-x");

    const remaining = await prisma.tiktokRoomCollabSource.count({ where: { watchedRoomId } });
    expect(remaining).toBe(1); // itest-source-multi-y のリンクは残る

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: watchedRoomId } });
    expect(after.lastWatchInstructedAt.getTime()).toBe(before.lastWatchInstructedAt.getTime());
  });

  it("唯一の発見元が解散すると、リンクが0件になりlastWatchInstructedAtが期限切れ方向へ倒れる", async () => {
    const watchedRoomId = await makeWatchedRoom("single", "itest-source-single");

    const before = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: watchedRoomId } });

    await releaseCollabSourceLinksBySource("itest-source-single");

    const remaining = await prisma.tiktokRoomCollabSource.count({ where: { watchedRoomId } });
    expect(remaining).toBe(0);

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: watchedRoomId } });
    expect(after.lastWatchInstructedAt.getTime()).toBeLessThan(before.lastWatchInstructedAt.getTime());
  });

  it("リンクが無いsourceRoomIdの解放はno-op(存在しないroomへの書き込みを試みない)", async () => {
    await expect(releaseCollabSourceLinksBySource("itest-source-nonexistent-xyz")).resolves.toBeUndefined();
  });

  it("他の発見元との競合: 削除直後に新しいリンクが作られていた場合、後発リンクがある限り停止しない(atomic conditional updateの検証)", async () => {
    const watchedRoomId = await makeWatchedRoom("race", "itest-source-race-a");

    // releaseCollabSourceLinksBySource() が deleteMany した「後」、conditional update が走る「前」に
    // 別workerが新しいリンクを作った状況を模す — applyExpiryToRoomsWithNoLinks は内部関数なので、
    // 同等の状況を「解放前に別発見元のリンクを先に張っておく」ことで再現する。
    await recordCollabSourceLink(watchedRoomId, "itest-source-race-b");

    const before = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: watchedRoomId } });
    await releaseCollabSourceLinksBySource("itest-source-race-a");
    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: watchedRoomId } });

    // race-b のリンクが生きているので停止しない
    expect(after.lastWatchInstructedAt.getTime()).toBe(before.lastWatchInstructedAt.getTime());
  });

  it("同一発見元との競合: findMany後〜deleteMany前に同じsourceRoomIdへ新しいコラボが再開されていた場合、その新リンクを誤って削除しない(cutoffの検証、code-review Codex指摘)", async () => {
    const watchedRoomId = await makeWatchedRoom("samesourcerace", "itest-source-same-race");

    // releaseCollabSourceLinksBySource() 呼び出し「開始後」に同じsourceRoomIdから再検知があった
    // 状況を、lastSeenAtを未来時刻へ直接書き換えることで模す(cutoff = 呼び出し開始時刻より後になる)。
    const future = new Date(Date.now() + 60_000);
    await prisma.tiktokRoomCollabSource.update({
      where: { watchedRoomId_sourceRoomId: { watchedRoomId, sourceRoomId: "itest-source-same-race" } },
      data: { lastSeenAt: future },
    });

    const before = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: watchedRoomId } });
    await releaseCollabSourceLinksBySource("itest-source-same-race");
    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: watchedRoomId } });

    // cutoff(呼び出し開始時刻)より後のlastSeenAtを持つリンクは削除対象から除外される
    const remaining = await prisma.tiktokRoomCollabSource.count({ where: { watchedRoomId } });
    expect(remaining).toBe(1);
    expect(after.lastWatchInstructedAt.getTime()).toBe(before.lastWatchInstructedAt.getTime());
  });
});

describe("cleanupStaleCollabSourceLinks", () => {
  it("lastSeenAtがTTLより古いリンクだけ削除し、0件になったroomのlastWatchInstructedAtを倒す", async () => {
    const watchedRoomId = await makeWatchedRoom("ttl", "itest-source-ttl");
    const staleAt = new Date(Date.now() - 60 * 60_000); // 1時間前(30分TTLを超える)
    await prisma.tiktokRoomCollabSource.update({
      where: { watchedRoomId_sourceRoomId: { watchedRoomId, sourceRoomId: "itest-source-ttl" } },
      data: { lastSeenAt: staleAt },
    });

    const before = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: watchedRoomId } });
    await cleanupStaleCollabSourceLinks();
    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: watchedRoomId } });

    const remaining = await prisma.tiktokRoomCollabSource.count({ where: { watchedRoomId } });
    expect(remaining).toBe(0);
    expect(after.lastWatchInstructedAt.getTime()).toBeLessThan(before.lastWatchInstructedAt.getTime());
  });

  it("lastSeenAtが新しいリンクはTTL cleanupの対象にならない", async () => {
    const watchedRoomId = await makeWatchedRoom("fresh", "itest-source-fresh");

    const before = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: watchedRoomId } });
    await cleanupStaleCollabSourceLinks();
    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: watchedRoomId } });

    const remaining = await prisma.tiktokRoomCollabSource.count({ where: { watchedRoomId } });
    expect(remaining).toBe(1);
    expect(after.lastWatchInstructedAt.getTime()).toBe(before.lastWatchInstructedAt.getTime());
  });
});

describe("既存の監視理由がある room は停止処理の影響を受けない(watchedRoomFilter()不変条件)", () => {
  it("specialWatch:trueのroomはリンクが0件になってもlastWatchInstructedAtが倒れる(枝5は影響を受けるが枝4で監視は維持される)", async () => {
    const watchedRoomId = await makeWatchedRoom("special", "itest-source-special");
    await prisma.tiktokRoom.update({ where: { id: watchedRoomId }, data: { specialWatch: true } });

    const before = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: watchedRoomId } });
    await releaseCollabSourceLinksBySource("itest-source-special");
    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: watchedRoomId } });

    // applyExpiryToRoomsWithNoLinks自体はlastWatchInstructedAtを無条件に(枝5の判定材料としてのみ)倒す —
    // watchedRoomFilter()を変更しない設計なので、specialWatch:trueのroomは枝4により
    // 実際の監視対象判定(watchedRoomFilter()呼び出し側)には影響しない。この行はその副作用を確認する。
    expect(after.lastWatchInstructedAt.getTime()).toBeLessThan(before.lastWatchInstructedAt.getTime());
  });
});
