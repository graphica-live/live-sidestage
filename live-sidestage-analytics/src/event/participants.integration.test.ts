// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import type { ExistenceChecker } from "@/lib/tiktok-existence";
import type { AccountExistence, AccountExistenceCheck } from "@/lib/tiktok-profile";
import { ensureRoomForEvent } from "@/lib/tiktok-room";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";
import { ParticipantError, registerParticipant } from "./participants";

const PREFIX = "itest_pexist";
let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;

const createdEventIds: string[] = [];
const createdTiktokHandles: string[] = [];

/**
 * ハンドルから決定的に導く tiktokUid。TiktokRoom.hostTiktokUid は @unique なので、
 * テストごとに一意なハンドルを使っている以上 uid も一意になる。
 */
const uidOf = (tiktokHandle: string) => makeTiktokUid(tiktokHandle);

/** 判定を決め打ちする checker。nickname は null。呼び出し回数を数える。 */
function stubChecker(verdict: AccountExistence): ExistenceChecker & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async check(tiktokHandle: string) {
      calls.push(tiktokHandle);
      // uid が取れない応答は登録ゲートが 503 で止めるので、EXISTS のときは必ず返す。
      return { verdict, nickname: null, tiktokUid: uidOf(tiktokHandle) };
    },
    size: () => 0,
  };
}

/** verdict と nickname を両方決め打ちする checker。 */
function stubCheckerWithNickname(
  check: AccountExistenceCheck
): ExistenceChecker & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async check(tiktokHandle: string) {
      calls.push(tiktokHandle);
      return check;
    },
    size: () => 0,
  };
}

async function createEvent() {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} 参加者登録テスト`,
      ownerPrincipalId: `${PREFIX}_owner_${uniqueSuffix()}`,
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
function testTiktokHandle() {
  const id = `${PREFIX}_${uniqueSuffix()}`.toLowerCase();
  createdTiktokHandles.push(id);
  return id;
}

afterEach(async () => {
  // 監視要求を残したまま次のテストへ行かない。
  await prisma.tiktokRoom
    .updateMany({ where: { tiktokHandle: { in: createdTiktokHandles } }, data: { monitorUntil: null } })
    .catch(() => {});
});

afterAll(async () => {
  for (const id of createdEventIds) {
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  if (createdTiktokHandles.length > 0) {
    await prisma.tiktokRoom.deleteMany({ where: { tiktokHandle: { in: createdTiktokHandles } } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe("registerParticipant の実在確認", () => {
  it("TikTok 上に存在しない ID は 400 で弾き、room も参加者も作らない", async () => {
    const event = await createEvent();
    const tiktokHandle = testTiktokHandle();
    const checker = stubChecker("MISSING");

    await expect(
      registerParticipant({ eventId: event.id, rawTiktokHandle: tiktokHandle }, { checker })
    ).rejects.toMatchObject({ status: 400 });

    expect(checker.calls).toEqual([tiktokHandle]);
    expect(
      await prisma.tiktokRoom.findUnique({ where: { hostTiktokUid: uidOf(tiktokHandle) } })
    ).toBeNull();
    expect(await prisma.eventParticipant.count({ where: { eventId: event.id } })).toBe(0);
    expect(await prisma.eventRoomLease.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("実在を確認できたら登録し、existence は VERIFIED になる", async () => {
    const event = await createEvent();
    const tiktokHandle = testTiktokHandle();

    const result = await registerParticipant(
      { eventId: event.id, rawTiktokHandle: `@${tiktokHandle}` },
      { checker: stubChecker("EXISTS") }
    );

    expect(result.tiktokHandle).toBe(tiktokHandle);
    expect(result.existence).toBe("VERIFIED");
    expect(await prisma.eventParticipant.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("判定できなかったら登録を拒否する(fail-closed)", async () => {
    const event = await createEvent();
    const tiktokHandle = testTiktokHandle();

    await expect(
      registerParticipant(
        { eventId: event.id, rawTiktokHandle: tiktokHandle },
        { checker: stubChecker("UNVERIFIED") }
      )
    ).rejects.toMatchObject({ status: 503 });

    expect(await prisma.eventParticipant.count({ where: { eventId: event.id } })).toBe(0);
  });

  // kill switch(TIKTOK_EXISTENCE_CHECK_DISABLED)は TikTok への問い合わせを止めるだけで、
  // 登録を通す手段ではなくなった。`TiktokRoom.hostTiktokUid` / `EventParticipant.tiktokUid` が
  // NOT NULL になり、uid の入手経路が実在確認の応答しかないため(§6 の登録ゲート)。
  // `requireExistingTiktokAccount` を使う他の登録経路(Streamer / AgencyWatch)も同じ扱い。
  it("kill switch を立てても uid が取れないので登録は通らない(TikTok は叩かない)", async () => {
    const event = await createEvent();
    const tiktokHandle = testTiktokHandle();
    const checker = stubChecker("MISSING");

    await expect(
      registerParticipant(
        { eventId: event.id, rawTiktokHandle: tiktokHandle },
        { checker, existenceDisabled: true }
      )
    ).rejects.toMatchObject({ status: 503 });

    expect(checker.calls).toEqual([]);
    expect(await prisma.eventParticipant.count({ where: { eventId: event.id } })).toBe(0);
    expect(
      await prisma.tiktokRoom.findUnique({ where: { hostTiktokUid: uidOf(tiktokHandle) } })
    ).toBeNull();
  });

  // 重複判定のキーがハンドルから不変の uid へ移ったので、重複を知るには先に実在確認が要る
  // (以前は「409 が先に落とすので TikTok を叩かない」だった)。上限・チーム不正・形式不正で
  // 落ちる登録が TikTok を叩かないことは変わらない。
  it("重複登録は 409。uid で判定するので実在確認は1回だけ走る", async () => {
    const event = await createEvent();
    const tiktokHandle = testTiktokHandle();
    await registerParticipant(
      { eventId: event.id, rawTiktokHandle: tiktokHandle },
      { checker: stubChecker("EXISTS") }
    );

    const checker = stubChecker("EXISTS");
    await expect(
      registerParticipant({ eventId: event.id, rawTiktokHandle: tiktokHandle }, { checker })
    ).rejects.toMatchObject({ status: 409 });

    expect(checker.calls).toEqual([tiktokHandle]);
    expect(await prisma.eventParticipant.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("形式が不正な ID では TikTok を叩かない", async () => {
    const event = await createEvent();
    const checker = stubChecker("EXISTS");

    await expect(
      registerParticipant({ eventId: event.id, rawTiktokHandle: "@@bad id!" }, { checker })
    ).rejects.toBeInstanceOf(ParticipantError);

    expect(checker.calls).toEqual([]);
  });
});

describe("registerParticipant の表示名フォールバック", () => {
  it("未入力かつ実在確認でニックネームが取れたら、それを表示名にする", async () => {
    const event = await createEvent();
    const tiktokHandle = testTiktokHandle();

    const result = await registerParticipant(
      { eventId: event.id, rawTiktokHandle: tiktokHandle },
      { checker: stubCheckerWithNickname({ verdict: "EXISTS", nickname: "テスト配信者", tiktokUid: uidOf(tiktokHandle) }) }
    );

    const participant = await prisma.eventParticipant.findUniqueOrThrow({
      where: { id: result.participantId },
    });
    expect(participant.displayName).toBe("テスト配信者");
  });

  it("主催者が表示名を明示したら、ニックネームが取れても明示側を優先する", async () => {
    const event = await createEvent();
    const tiktokHandle = testTiktokHandle();

    const result = await registerParticipant(
      {
        eventId: event.id,
        rawTiktokHandle: tiktokHandle,
        displayName: "主催者が入れた名前",
      },
      { checker: stubCheckerWithNickname({ verdict: "EXISTS", nickname: "テスト配信者", tiktokUid: uidOf(tiktokHandle) }) }
    );

    const participant = await prisma.eventParticipant.findUniqueOrThrow({
      where: { id: result.participantId },
    });
    expect(participant.displayName).toBe("主催者が入れた名前");
  });

  it("実在は確認できたがニックネームが取れなければ TikTok ID にフォールバックする", async () => {
    const event = await createEvent();
    const tiktokHandle = testTiktokHandle();

    const result = await registerParticipant(
      { eventId: event.id, rawTiktokHandle: tiktokHandle },
      { checker: stubChecker("EXISTS") }
    );

    const participant = await prisma.eventParticipant.findUniqueOrThrow({
      where: { id: result.participantId },
    });
    expect(participant.displayName).toBe(tiktokHandle);
  });

  // kill switch 経路の表示名フォールバックは到達不能になった(uid が取れないので登録自体が
  // 503 で止まる)。フォールバックの中身は上の「ニックネームが取れなければ」ケースが押さえて
  // いるので、ここは「表示名を決める手前で止まる」ことだけを固定する。
  it("kill switch では表示名を決める手前で 503 になり、参加者行を作らない", async () => {
    const event = await createEvent();
    const tiktokHandle = testTiktokHandle();

    await expect(
      registerParticipant(
        { eventId: event.id, rawTiktokHandle: tiktokHandle },
        { checker: stubChecker("MISSING"), existenceDisabled: true }
      )
    ).rejects.toMatchObject({ status: 503 });

    expect(await prisma.eventParticipant.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("表示名の上限(60文字)を超えるニックネームは採用せず TikTok ID にフォールバックする", async () => {
    const event = await createEvent();
    const tiktokHandle = testTiktokHandle();
    const longNickname = "あ".repeat(61);

    const result = await registerParticipant(
      { eventId: event.id, rawTiktokHandle: tiktokHandle },
      { checker: stubCheckerWithNickname({ verdict: "EXISTS", nickname: longNickname, tiktokUid: uidOf(tiktokHandle) }) }
    );

    const participant = await prisma.eventParticipant.findUniqueOrThrow({
      where: { id: result.participantId },
    });
    expect(participant.displayName).toBe(tiktokHandle);
  });

  it("改行を含むニックネームは採用せず TikTok ID にフォールバックする", async () => {
    const event = await createEvent();
    const tiktokHandle = testTiktokHandle();

    const result = await registerParticipant(
      { eventId: event.id, rawTiktokHandle: tiktokHandle },
      { checker: stubCheckerWithNickname({ verdict: "EXISTS", nickname: "改行\n入り", tiktokUid: uidOf(tiktokHandle) }) }
    );

    const participant = await prisma.eventParticipant.findUniqueOrThrow({
      where: { id: result.participantId },
    });
    expect(participant.displayName).toBe(tiktokHandle);
  });
});

describe("登録の補償が他の登録の監視を止めないこと", () => {
  it("同じ ID の並行登録で負けた側の補償が、勝った側の monitorUntil を消さない", async () => {
    const event = await createEvent();
    const tiktokHandle = testTiktokHandle();

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
        return { verdict: "EXISTS", nickname: null, tiktokUid: uidOf(tiktokHandle) };
      },
      size: () => 0,
    };

    const loser = registerParticipant(
      { eventId: event.id, rawTiktokHandle: tiktokHandle },
      { checker: blockingChecker }
    );
    await reachedCheck;

    // 勝者: room を確保し、参加者行と lease を作る。
    const leased = await ensureRoomForEvent(
      { tiktokUid: uidOf(tiktokHandle), tiktokHandle, nickname: null },
      new Date(Date.now() + 24 * 60 * 60 * 1000)
    );
    await prisma.eventParticipant.create({
      data: {
        eventId: event.id,
        tiktokUid: uidOf(tiktokHandle),
        tiktokHandle,
        roomId: leased.roomId,
        displayName: tiktokHandle,
      },
    });
    await prisma.eventRoomLease.create({
      data: {
        eventId: event.id,
        roomId: leased.roomId,
        tiktokUid: uidOf(tiktokHandle),
        tiktokHandle,
        createdBySystem: leased.created,
        monitorUntil: leased.monitorUntil,
        releasedAt: null,
      },
    });

    release();
    await expect(loser).rejects.toMatchObject({ status: 409 });

    // 勝者の監視要求が生きていること。ここが本題。
    const room = await prisma.tiktokRoom.findUnique({
      where: { hostTiktokUid: uidOf(tiktokHandle) },
      select: { monitorUntil: true },
    });
    expect(room?.monitorUntil).not.toBeNull();
    expect(room!.monitorUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("他に lease が残っていなければ、補償はこれまでどおり監視を解除する", async () => {
    const event = await createEvent();
    const tiktokHandle = testTiktokHandle();

    // 参加者上限を使うと外部確認より前に落ちるので、チーム不正で「確認後・書き込み前」を作れない。
    // 代わりに、存在しない teamId ではなく **一意制約に当たらない失敗**を作るのは難しいため、
    // ここでは補償対象がない状態(登録成功)と、そこから参加者を消したときの解除を確認する。
    const result = await registerParticipant(
      { eventId: event.id, rawTiktokHandle: tiktokHandle },
      { checker: stubChecker("EXISTS") }
    );

    const before = await prisma.tiktokRoom.findUnique({
      where: { hostTiktokUid: uidOf(tiktokHandle) },
      select: { monitorUntil: true },
    });
    expect(before?.monitorUntil).not.toBeNull();

    const { removeParticipant } = await import("./participants");
    await removeParticipant(event.id, result.participantId);

    const after = await prisma.tiktokRoom.findUnique({
      where: { hostTiktokUid: uidOf(tiktokHandle) },
      select: { monitorUntil: true },
    });
    expect(after?.monitorUntil).toBeNull();
  });
});
