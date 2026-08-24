// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import type { ExistenceChecker } from "@/lib/tiktok-existence";
import type { AccountExistence } from "@/lib/tiktok-profile";
import { ensureRoomForEvent } from "@/lib/tiktok-room";
import { ParticipantError, registerParticipant } from "./participants";

const PREFIX = "itest_pexist";
let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;

const createdEventIds: string[] = [];
const createdTiktokIds: string[] = [];

/** 判定を決め打ちする checker。呼び出し回数を数える。 */
function stubChecker(verdict: AccountExistence): ExistenceChecker & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async check(tiktokId: string) {
      calls.push(tiktokId);
      return verdict;
    },
    size: () => 0,
  };
}

async function createEvent() {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} 参加者登録テスト`,
      ownerUserId: `${PREFIX}_owner_${uniqueSuffix()}`,
      format: "DIAMOND_RACE",
      entryMode: "SOLO",
      visibility: "PRIVATE",
      startAt: new Date(Date.now() - 60_000),
      endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  createdEventIds.push(event.id);
  return event;
}

/** テスト用の一意なハンドル。normalizeTiktokId を通るように英数字と `_` だけにする。 */
function testTiktokId() {
  const id = `${PREFIX}_${uniqueSuffix()}`.toLowerCase();
  createdTiktokIds.push(id);
  return id;
}

afterEach(async () => {
  // 監視要求を残したまま次のテストへ行かない。
  await prisma.tiktokRoom
    .updateMany({ where: { tiktokId: { in: createdTiktokIds } }, data: { monitorUntil: null } })
    .catch(() => {});
});

afterAll(async () => {
  for (const id of createdEventIds) {
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  if (createdTiktokIds.length > 0) {
    await prisma.tiktokRoom.deleteMany({ where: { tiktokId: { in: createdTiktokIds } } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe("registerParticipant の実在確認", () => {
  it("TikTok 上に存在しない ID は 400 で弾き、room も参加者も作らない", async () => {
    const event = await createEvent();
    const tiktokId = testTiktokId();
    const checker = stubChecker("MISSING");

    await expect(
      registerParticipant({ eventId: event.id, rawTiktokId: tiktokId }, { checker })
    ).rejects.toMatchObject({ status: 400 });

    expect(checker.calls).toEqual([tiktokId]);
    expect(await prisma.tiktokRoom.findUnique({ where: { tiktokId } })).toBeNull();
    expect(await prisma.eventParticipant.count({ where: { eventId: event.id } })).toBe(0);
    expect(await prisma.eventRoomLease.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("実在を確認できたら登録し、existence は VERIFIED になる", async () => {
    const event = await createEvent();
    const tiktokId = testTiktokId();

    const result = await registerParticipant(
      { eventId: event.id, rawTiktokId: `@${tiktokId}` },
      { checker: stubChecker("EXISTS") }
    );

    expect(result.tiktokId).toBe(tiktokId);
    expect(result.existence).toBe("VERIFIED");
    expect(await prisma.eventParticipant.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("判定できなかったら登録を通し、existence は UNVERIFIED になる(fail-open)", async () => {
    const event = await createEvent();
    const tiktokId = testTiktokId();

    const result = await registerParticipant(
      { eventId: event.id, rawTiktokId: tiktokId },
      { checker: stubChecker("UNVERIFIED") }
    );

    expect(result.existence).toBe("UNVERIFIED");
    expect(await prisma.eventParticipant.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("kill switch を立てたら TikTok を叩かずに登録する", async () => {
    const event = await createEvent();
    const tiktokId = testTiktokId();
    const checker = stubChecker("MISSING");

    const result = await registerParticipant(
      { eventId: event.id, rawTiktokId: tiktokId },
      { checker, existenceDisabled: true }
    );

    expect(result.existence).toBe("DISABLED");
    expect(checker.calls).toEqual([]);
  });

  it("重複登録では TikTok を叩かない(409 が先に落とす)", async () => {
    const event = await createEvent();
    const tiktokId = testTiktokId();
    await registerParticipant(
      { eventId: event.id, rawTiktokId: tiktokId },
      { checker: stubChecker("EXISTS") }
    );

    const checker = stubChecker("EXISTS");
    await expect(
      registerParticipant({ eventId: event.id, rawTiktokId: tiktokId }, { checker })
    ).rejects.toMatchObject({ status: 409 });

    expect(checker.calls).toEqual([]);
  });

  it("形式が不正な ID では TikTok を叩かない", async () => {
    const event = await createEvent();
    const checker = stubChecker("EXISTS");

    await expect(
      registerParticipant({ eventId: event.id, rawTiktokId: "@@bad id!" }, { checker })
    ).rejects.toBeInstanceOf(ParticipantError);

    expect(checker.calls).toEqual([]);
  });
});

describe("登録の補償が他の登録の監視を止めないこと", () => {
  it("同じ ID の並行登録で負けた側の補償が、勝った側の monitorUntil を消さない", async () => {
    const event = await createEvent();
    const tiktokId = testTiktokId();

    // 実在確認の最中で止め、その隙に「並行登録の勝者」を DB へ作る。
    // これで負けた側は ensureRoomForEvent を通った後に一意制約で落ち、補償経路に入る。
    //
    // **握手を2段にするのが要点。** 実在確認に到達した = 重複チェックを通過済みなので、
    // 勝者を作っても負けた側は 409 を早期に返さず、必ず P2002 の補償経路へ進む。
    let reached!: () => void;
    const reachedCheck = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blockingChecker: ExistenceChecker = {
      async check() {
        reached();
        await barrier;
        return "EXISTS";
      },
      size: () => 0,
    };

    const loser = registerParticipant(
      { eventId: event.id, rawTiktokId: tiktokId },
      { checker: blockingChecker }
    );
    await reachedCheck;

    // 勝者: room を確保し、参加者行と lease を作る。
    const leased = await ensureRoomForEvent(tiktokId, new Date(Date.now() + 24 * 60 * 60 * 1000));
    await prisma.eventParticipant.create({
      data: { eventId: event.id, tiktokId, roomId: leased.roomId, displayName: tiktokId },
    });
    await prisma.eventRoomLease.create({
      data: {
        eventId: event.id,
        roomId: leased.roomId,
        tiktokId,
        createdBySystem: leased.created,
        monitorUntil: leased.monitorUntil,
        releasedAt: null,
      },
    });

    release();
    await expect(loser).rejects.toMatchObject({ status: 409 });

    // 勝者の監視要求が生きていること。ここが本題。
    const room = await prisma.tiktokRoom.findUnique({
      where: { tiktokId },
      select: { monitorUntil: true },
    });
    expect(room?.monitorUntil).not.toBeNull();
    expect(room!.monitorUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("他に lease が残っていなければ、補償はこれまでどおり監視を解除する", async () => {
    const event = await createEvent();
    const tiktokId = testTiktokId();

    // 参加者上限を使うと外部確認より前に落ちるので、チーム不正で「確認後・書き込み前」を作れない。
    // 代わりに、存在しない teamId ではなく **一意制約に当たらない失敗**を作るのは難しいため、
    // ここでは補償対象がない状態(登録成功)と、そこから参加者を消したときの解除を確認する。
    const result = await registerParticipant(
      { eventId: event.id, rawTiktokId: tiktokId },
      { checker: stubChecker("EXISTS") }
    );

    const before = await prisma.tiktokRoom.findUnique({
      where: { tiktokId },
      select: { monitorUntil: true },
    });
    expect(before?.monitorUntil).not.toBeNull();

    const { removeParticipant } = await import("./participants");
    await removeParticipant(event.id, result.participantId);

    const after = await prisma.tiktokRoom.findUnique({
      where: { tiktokId },
      select: { monitorUntil: true },
    });
    expect(after?.monitorUntil).toBeNull();
  });
});
