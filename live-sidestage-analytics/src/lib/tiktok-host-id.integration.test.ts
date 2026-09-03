// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// **ここで固定するのは hostUserId の書き込み規律そのもの。** ユニット側は
// saveHostUserId / markAttempt をスタブへ差し替えるので、実際の updateMany の
// WHERE 句(HOST_USER_ID_WRITABLE_WHERE)は一度も実行されない。規律を削っても
// ユニットは緑のままなので、実DBに対する確認をここに置く。
//
// 守っている不変条件:
//   A. fill-once — 一度入った hostUserId は上書きしない
//   B. user_not_found を明示された room には二度と書かない(バトル逆引き経路も含む)
//   C. 候補抽出が B を尊重する(諦めた room を拾い直さない)
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  backfillStreamerRoomHostIds,
  clearHostIdBackoff,
  saveHostUserIdOnce,
} from "./tiktok-host-id";
import { clearBattleFillCache, fillHostUserIdFromBattle } from "./tiktok-id-migration";

const suffix = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const roomIds: string[] = [];
const userIds: string[] = [];

function handle(tag: string) {
  return `itesthid${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

async function makeRoom(data: {
  tag: string;
  hostUserId?: string | null;
  hostUserIdBackfillGaveUpAt?: Date | null;
  hostUserIdAttemptedAt?: Date | null;
  withStreamer?: boolean;
}) {
  const room = await prisma.tiktokRoom.create({
    data: {
      tiktokId: handle(data.tag),
      hostUserId: data.hostUserId ?? null,
      hostUserIdBackfillGaveUpAt: data.hostUserIdBackfillGaveUpAt ?? null,
      hostUserIdAttemptedAt: data.hostUserIdAttemptedAt ?? null,
    },
    select: { id: true, tiktokId: true },
  });
  roomIds.push(room.id);

  if (data.withStreamer) {
    const user = await prisma.user.create({
      data: { email: `itest-hid-${suffix()}@local.test`, name: "itest" },
      select: { id: true },
    });
    userIds.push(user.id);
    await prisma.streamer.create({
      data: {
        userId: user.id,
        tiktokId: room.tiktokId,
        roomId: room.id,
        verificationCode: `itest-${suffix()}`,
        apiKey: `itest-key-${suffix()}`,
        overlayToken: `itest-overlay-${suffix()}`,
      },
    });
  }

  return room;
}

async function readRoom(id: string) {
  return prisma.tiktokRoom.findUniqueOrThrow({
    where: { id },
    select: { hostUserId: true, hostUserIdFilledAt: true, hostUserIdBackfillGaveUpAt: true },
  });
}

afterAll(async () => {
  await prisma.streamer.deleteMany({ where: { roomId: { in: roomIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("saveHostUserIdOnce", () => {
  it("未設定の room には書き、fill 時刻も残す", async () => {
    const room = await makeRoom({ tag: "fill" });

    await saveHostUserIdOnce(room.id, "6745191554084586");

    const after = await readRoom(room.id);
    expect(after.hostUserId).toBe("6745191554084586");
    expect(after.hostUserIdFilledAt).not.toBeNull();
  });

  // 不変条件A。hostUserId は不変値なので「先に入ったものが勝つ」。
  it("既に値がある room は上書きしない", async () => {
    const room = await makeRoom({ tag: "once", hostUserId: "111" });

    await saveHostUserIdOnce(room.id, "222");

    expect((await readRoom(room.id)).hostUserId).toBe("111");
  });

  // 不変条件B。**この期待が落ちるなら、改名で空いたハンドルを取得した第三者の
  // userId が room へ入りうる状態になっている**(将来の自動合流で他人の履歴が
  // 別人の room へ移る事故に直結する)。
  it("user_not_found を明示された room には書かない", async () => {
    const room = await makeRoom({ tag: "gaveup", hostUserIdBackfillGaveUpAt: new Date() });

    await saveHostUserIdOnce(room.id, "333");

    expect((await readRoom(room.id)).hostUserId).toBeNull();
  });
});

describe("fillHostUserIdFromBattle", () => {
  const profiles = (displayId: string, anchorId: string) => ({
    [anchorId]: { displayId, nickName: "itest", avatarUrl: "https://p16.tiktokcdn.com/x.webp" },
  });

  it("自分の displayId に一致する anchorId を書く", async () => {
    clearBattleFillCache();
    const room = await makeRoom({ tag: "battle" });

    await fillHostUserIdFromBattle(room.id, room.tiktokId, profiles(room.tiktokId, "6900000000001"));

    expect((await readRoom(room.id)).hostUserId).toBe("6900000000001");
  });

  // バトル逆引きは backfill とは別経路。**共有 WHERE を通っていないと、ここだけ
  // 規律が抜ける。** 経路が増えるたびに条件を書き写す設計だと必ずこれが起きる。
  it("user_not_found を明示された room にはバトル経由でも書かない", async () => {
    clearBattleFillCache();
    const room = await makeRoom({ tag: "bgaveup", hostUserIdBackfillGaveUpAt: new Date() });

    await fillHostUserIdFromBattle(room.id, room.tiktokId, profiles(room.tiktokId, "6900000000002"));

    expect((await readRoom(room.id)).hostUserId).toBeNull();
  });

  it("既に値がある room は上書きしない", async () => {
    clearBattleFillCache();
    const room = await makeRoom({ tag: "bonce", hostUserId: "444" });

    await fillHostUserIdFromBattle(room.id, room.tiktokId, profiles(room.tiktokId, "6900000000003"));

    expect((await readRoom(room.id)).hostUserId).toBe("444");
  });
});

describe("backfillStreamerRoomHostIds の候補抽出", () => {
  it("諦めた room と充填済み room を候補から外し、Streamer のいない room も拾わない", async () => {
    clearHostIdBackoff();

    const target = await makeRoom({ tag: "cand", withStreamer: true });
    const gaveUp = await makeRoom({
      tag: "candgone",
      hostUserIdBackfillGaveUpAt: new Date(),
      withStreamer: true,
    });
    const filled = await makeRoom({ tag: "candfilled", hostUserId: "555", withStreamer: true });
    const orphan = await makeRoom({ tag: "candorphan" });

    const asked: string[] = [];
    await backfillStreamerRoomHostIds({
      sleep: async () => {},
      concurrency: 8,
      batchDelayMs: 0,
      markAttempt: async () => {},
      saveHostUserId: async () => {},
      // 他のテストが作った room も同じ DB にいるので、上限で target を取りこぼさないよう
      // 広めに取る。**成功を返す**のはサーキットブレーカで途中打ち切りにしないため
      // (失敗を返すと連続失敗で abort し、候補の後半を見ないまま終わる)。
      maxPerRun: 1000,
      fetchProfile: async (tiktokId) => {
        asked.push(tiktokId);
        return {
          ok: true,
          profile: { avatarUrl: "https://p16.tiktokcdn.com/x.webp", nickname: null, userId: "1" },
        };
      },
    });

    expect(asked).toContain(target.tiktokId);
    expect(asked).not.toContain(gaveUp.tiktokId);
    expect(asked).not.toContain(filled.tiktokId);
    expect(asked).not.toContain(orphan.tiktokId);
  });
});
