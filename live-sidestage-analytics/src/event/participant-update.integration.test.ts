// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// 参加者の部分更新(表示名・所属チーム・TikTok ID)。守りたいのは3つ。
//   1. 検証に失敗したときに**片方だけ書き込まれない**こと(部分適用の禁止)
//   2. 改名が `tiktokId` / `roomId` / lease に一切触れないこと
//      (触ると TikTok 接続の同一性と集計の紐付けが壊れる)
//   3. TikTok ID の訂正が `EventParticipant.id` を維持したまま行われ、
//      ブラケットの枠(`EventMatchSideParticipant`)を壊さないこと
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import type { ExistenceChecker } from "@/lib/tiktok-existence";
import type { AccountExistence } from "@/lib/tiktok-profile";
import { ParticipantError, updateParticipant } from "./participants";

const PREFIX = "itest_prtupd";
const NOW = Date.now();
const START = new Date(NOW - 86_400_000);
const END = new Date(NOW + 86_400_000);

let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;
const createdEventIds: string[] = [];
const createdRoomIds: string[] = [];
// tiktokId 訂正テストが ensureRoomForEvent 経由で実際に立てた監視要求(未来の
// monitorUntil)を記録し、他の並行 listener 系テストへ漏らさないよう後片付けする
// (participants.integration.test.ts と同じ理由・同じパターン)。
const createdTiktokIds: string[] = [];

/** 判定を決め打ちする checker。nickname は null。呼び出し回数を数える。 */
function stubChecker(verdict: AccountExistence): ExistenceChecker & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async check(tiktokId: string) {
      calls.push(tiktokId);
      return { verdict, nickname: null, userId: null };
    },
    size: () => 0,
  };
}

async function newEvent() {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} イベント`,
      ownerUserId: `${PREFIX}_owner`,
      format: "DIAMOND_RACE",
      entryMode: "TEAM",
      status: "RUNNING",
      startAt: START,
      endAt: END,
      sessions: { create: [{ name: "1日目", startAt: START, endAt: END }] },
    },
    select: { id: true },
  });
  createdEventIds.push(event.id);
  return event.id;
}

/**
 * `public."TiktokRoom"` を1行作って参加者を1人ぶら下げる。lease も台帳へ入れる。
 *
 * `TiktokRoom.monitorUntil` は**立てず**、`monitoringSuspended` を **true** にする
 * （`session-update.integration.test.ts` と同じ）。未来の期限を入れた場合はもちろん、
 * `watchedRoomFilter()` が「Streamer 0人でも `monitoringSuspended` が false なら監視対象」へ
 * 変わったため**何も付けない部屋も監視対象になる**。監視対象になると、並行して走る
 * listener 系テストの `getMyRooms()` が未割当の監視対象を**グローバルに**claim して
 * `workerId` を書きに来る。改名の検証には要らないので、共有プールへ足さない。
 */
async function newParticipant(eventId: string, displayName: string, handle?: string) {
  const tiktokId = handle ?? `${PREFIX}_${uniqueSuffix()}`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO public."TiktokRoom" (id, "tiktokId", "createdAt", "monitoringSuspended")
    VALUES (gen_random_uuid()::text, ${tiktokId}, NOW(), true)
    RETURNING id
  `;
  createdRoomIds.push(rows[0].id);

  const participant = await prisma.eventParticipant.create({
    data: { eventId, tiktokId, roomId: rows[0].id, displayName },
    select: { id: true },
  });
  await prisma.eventRoomLease.create({
    data: { eventId, roomId: rows[0].id, tiktokId, monitorUntil: END },
  });

  return { id: participant.id, tiktokId, roomId: rows[0].id };
}

async function newTeam(eventId: string, name: string) {
  const team = await prisma.eventTeam.create({
    data: { eventId, name },
    select: { id: true },
  });
  return team.id;
}

/** TikTok ID 訂正の訂正先として使う一意なハンドル(未使用のIDである必要がある)。 */
function newTiktokId() {
  const id = `${PREFIX}_${uniqueSuffix()}`.toLowerCase();
  createdTiktokIds.push(id);
  return id;
}

afterEach(async () => {
  // ensureRoomForEvent が立てた監視要求を残さない(並行 listener 系テストとの干渉回避)。
  if (createdTiktokIds.length > 0) {
    await prisma.tiktokRoom
      .updateMany({ where: { tiktokId: { in: createdTiktokIds } }, data: { monitorUntil: null } })
      .catch(() => {});
  }
});

afterAll(async () => {
  for (const id of createdEventIds) {
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdRoomIds) {
    await prisma.$executeRaw`DELETE FROM public."TiktokRoom" WHERE id = ${id}`.catch(() => {});
  }
  if (createdTiktokIds.length > 0) {
    await prisma.tiktokRoom.deleteMany({ where: { tiktokId: { in: createdTiktokIds } } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe("updateParticipant", () => {
  it("表示名を変更でき、前後の空白は落ちる", async () => {
    const eventId = await newEvent();
    const p = await newParticipant(eventId, "旧ライバー");

    const result = await updateParticipant({
      eventId,
      participantId: p.id,
      patch: { displayName: "  新ライバー  " },
    });

    expect(result.displayName).toBe("新ライバー");
    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.displayName).toBe("新ライバー");
  });

  it("空文字を送ると TikTok ID に戻る", async () => {
    const eventId = await newEvent();
    const p = await newParticipant(eventId, "旧ライバー");

    await updateParticipant({ eventId, participantId: p.id, patch: { displayName: "" } });

    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.displayName).toBe(p.tiktokId);
  });

  it("表示名の上限(60)を超える TikTok ID でも空文字で戻せる", async () => {
    // fallback は長さ検査の対象外。ここが効かないと 61〜64文字のハンドルの参加者だけ
    // 「名前を空にして戻す」ができなくなる。
    const eventId = await newEvent();
    const longHandle = `${PREFIX}_${"a".repeat(64 - PREFIX.length - 1)}`;
    expect(longHandle.length).toBe(64);
    const p = await newParticipant(eventId, "旧ライバー", longHandle);

    await updateParticipant({ eventId, participantId: p.id, patch: { displayName: "" } });

    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.displayName).toBe(longHandle);
  });

  it("上限を超える表示名は400で拒否し、DBは変わらない", async () => {
    const eventId = await newEvent();
    const p = await newParticipant(eventId, "旧ライバー");

    await expect(
      updateParticipant({ eventId, participantId: p.id, patch: { displayName: "あ".repeat(61) } })
    ).rejects.toMatchObject({ status: 400 });

    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.displayName).toBe("旧ライバー");
  });

  it("改名しても tiktokId / roomId / teamId / lease は動かない", async () => {
    const eventId = await newEvent();
    const teamId = await newTeam(eventId, "赤組");
    const p = await newParticipant(eventId, "旧ライバー");
    await updateParticipant({ eventId, participantId: p.id, patch: { teamId } });

    const leaseBefore = await prisma.eventRoomLease.findFirstOrThrow({
      where: { eventId, roomId: p.roomId },
    });

    await updateParticipant({ eventId, participantId: p.id, patch: { displayName: "新ライバー" } });

    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.tiktokId).toBe(p.tiktokId);
    expect(after.roomId).toBe(p.roomId);
    expect(after.teamId).toBe(teamId);

    const leaseAfter = await prisma.eventRoomLease.findFirstOrThrow({
      where: { eventId, roomId: p.roomId },
    });
    expect(leaseAfter.monitorUntil.toISOString()).toBe(leaseBefore.monitorUntil.toISOString());
    expect(leaseAfter.releasedAt).toBeNull();
  });

  it("チームの検証に落ちたら表示名も書き込まない(部分適用しない)", async () => {
    const eventId = await newEvent();
    const other = await newEvent();
    const foreignTeam = await newTeam(other, "他イベントの組");
    const p = await newParticipant(eventId, "旧ライバー");

    await expect(
      updateParticipant({
        eventId,
        participantId: p.id,
        patch: { displayName: "新ライバー", teamId: foreignTeam },
      })
    ).rejects.toMatchObject({ status: 400 });

    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.displayName).toBe("旧ライバー");
    expect(after.teamId).toBeNull();
  });

  it("表示名とチームを同時に変えられる", async () => {
    const eventId = await newEvent();
    const teamId = await newTeam(eventId, "青組");
    const p = await newParticipant(eventId, "旧ライバー");

    await updateParticipant({
      eventId,
      participantId: p.id,
      patch: { displayName: "新ライバー", teamId },
    });

    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.displayName).toBe("新ライバー");
    expect(after.teamId).toBe(teamId);
  });

  it("teamId: null で未所属に戻せる(従来の挙動)", async () => {
    const eventId = await newEvent();
    const teamId = await newTeam(eventId, "赤組");
    const p = await newParticipant(eventId, "ライバー");
    await updateParticipant({ eventId, participantId: p.id, patch: { teamId } });

    await updateParticipant({ eventId, participantId: p.id, patch: { teamId: null } });

    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.teamId).toBeNull();
    expect(after.displayName).toBe("ライバー");
  });

  it("他イベントの participantId は404で、その行を書き換えない", async () => {
    const eventId = await newEvent();
    const other = await newEvent();
    const victim = await newParticipant(other, "他イベントのライバー");

    await expect(
      updateParticipant({ eventId, participantId: victim.id, patch: { displayName: "乗っ取り" } })
    ).rejects.toBeInstanceOf(ParticipantError);

    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: victim.id } });
    expect(after.displayName).toBe("他イベントのライバー");
  });

  it("存在しない participantId は404", async () => {
    const eventId = await newEvent();

    await expect(
      updateParticipant({ eventId, participantId: "missing", patch: { displayName: "x" } })
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("updateParticipant の TikTok ID 訂正", () => {
  it("訂正できて正規化される(existence は VERIFIED)", async () => {
    const eventId = await newEvent();
    const p = await newParticipant(eventId, "旧ライバー");
    const newId = newTiktokId();

    const result = await updateParticipant(
      { eventId, participantId: p.id, patch: { tiktokId: `@${newId.toUpperCase()}` } },
      { checker: stubChecker("EXISTS") }
    );

    expect(result.tiktokIdChanged).toBe(true);
    expect(result.tiktokId).toBe(newId);
    expect(result.existence).toBe("VERIFIED");

    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.tiktokId).toBe(newId);
    expect(after.roomId).not.toBe(p.roomId);
  });

  it("正規化後に現在値と同じなら no-op になり、TikTokを叩かない", async () => {
    const eventId = await newEvent();
    const p = await newParticipant(eventId, "ライバー");
    const checker = stubChecker("EXISTS");

    const result = await updateParticipant(
      { eventId, participantId: p.id, patch: { tiktokId: `@${p.tiktokId.toUpperCase()}` } },
      { checker }
    );

    expect(result.tiktokIdChanged).toBe(false);
    expect(checker.calls).toEqual([]);
    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.roomId).toBe(p.roomId);
  });

  it("コア要件: 訂正しても EventParticipant.id は不変で、ブラケットの枠が保持される", async () => {
    const eventId = await newEvent();
    const session = await prisma.eventSession.findFirstOrThrow({
      where: { eventId },
      select: { id: true },
    });
    const p1 = await newParticipant(eventId, "ライバーA");
    const p2 = await newParticipant(eventId, "ライバーB");

    const match = await prisma.eventMatch.create({
      data: { eventId, sessionId: session.id, round: 1, bracketPosition: 0 },
      select: { id: true },
    });
    const side0 = await prisma.eventMatchSide.create({
      data: { matchId: match.id, sideIndex: 0 },
      select: { id: true },
    });
    const side1 = await prisma.eventMatchSide.create({
      data: { matchId: match.id, sideIndex: 1 },
      select: { id: true },
    });
    await prisma.eventMatchSideParticipant.create({
      data: { sideId: side0.id, participantId: p1.id },
    });
    await prisma.eventMatchSideParticipant.create({
      data: { sideId: side1.id, participantId: p2.id },
    });

    const newId = newTiktokId();
    await updateParticipant(
      { eventId, participantId: p1.id, patch: { tiktokId: newId } },
      { checker: stubChecker("EXISTS") }
    );

    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p1.id } });
    expect(after.id).toBe(p1.id);
    expect(after.tiktokId).toBe(newId);

    const sideParticipant = await prisma.eventMatchSideParticipant.findFirstOrThrow({
      where: { sideId: side0.id },
    });
    expect(sideParticipant.participantId).toBe(p1.id);
  });

  it("訂正すると新roomのleaseが作られ、旧roomのleaseは解放マークされる", async () => {
    const eventId = await newEvent();
    const p = await newParticipant(eventId, "ライバー");
    const newId = newTiktokId();

    await updateParticipant(
      { eventId, participantId: p.id, patch: { tiktokId: newId } },
      { checker: stubChecker("EXISTS") }
    );

    const newLease = await prisma.eventRoomLease.findFirstOrThrow({
      where: { eventId, tiktokId: newId },
    });
    expect(newLease.releasedAt).toBeNull();
    expect(newLease.monitorUntil.getTime()).toBeGreaterThan(Date.now());

    const oldLease = await prisma.eventRoomLease.findFirstOrThrow({
      where: { eventId, roomId: p.roomId },
    });
    expect(oldLease.releasedAt).not.toBeNull();
  });

  it("旧roomを他イベントも使っていれば、旧roomの監視は解除されない", async () => {
    const eventId = await newEvent();
    const otherEventId = await newEvent();
    const p = await newParticipant(eventId, "ライバー");
    await prisma.tiktokRoom.update({ where: { id: p.roomId }, data: { monitorUntil: END } });
    await prisma.eventParticipant.create({
      data: { eventId: otherEventId, tiktokId: p.tiktokId, roomId: p.roomId, displayName: "他イベント" },
    });
    await prisma.eventRoomLease.create({
      data: { eventId: otherEventId, roomId: p.roomId, tiktokId: p.tiktokId, monitorUntil: END },
    });

    const newId = newTiktokId();
    await updateParticipant(
      { eventId, participantId: p.id, patch: { tiktokId: newId } },
      { checker: stubChecker("EXISTS") }
    );

    const room = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: p.roomId } });
    expect(room.monitorUntil).not.toBeNull();

    await prisma.tiktokRoom
      .update({ where: { id: p.roomId }, data: { monitorUntil: null } })
      .catch(() => {});
  });

  it("tiktokId・displayName・teamId を同時に変更できる", async () => {
    const eventId = await newEvent();
    const teamId = await newTeam(eventId, "青組");
    const p = await newParticipant(eventId, "旧ライバー");
    const newId = newTiktokId();

    const result = await updateParticipant(
      {
        eventId,
        participantId: p.id,
        patch: { tiktokId: newId, displayName: "新ライバー", teamId },
      },
      { checker: stubChecker("EXISTS") }
    );

    expect(result.tiktokIdChanged).toBe(true);
    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.tiktokId).toBe(newId);
    expect(after.displayName).toBe("新ライバー");
    expect(after.teamId).toBe(teamId);
  });

  it("displayName を指定せずに tiktokId だけ訂正すると、表示名は変わらない(自動追従しない)", async () => {
    const eventId = await newEvent();
    const p = await newParticipant(eventId, "旧ライバー");
    const newId = newTiktokId();

    await updateParticipant(
      { eventId, participantId: p.id, patch: { tiktokId: newId } },
      { checker: stubChecker("EXISTS") }
    );

    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.displayName).toBe("旧ライバー");
  });

  it("同一イベント内の他参加者が使っている TikTok ID への訂正は409で、TikTokを叩かない", async () => {
    const eventId = await newEvent();
    const p1 = await newParticipant(eventId, "ライバーA");
    const p2 = await newParticipant(eventId, "ライバーB");
    const checker = stubChecker("EXISTS");

    await expect(
      updateParticipant(
        { eventId, participantId: p2.id, patch: { tiktokId: p1.tiktokId } },
        { checker }
      )
    ).rejects.toMatchObject({ status: 409 });

    expect(checker.calls).toEqual([]);
    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p2.id } });
    expect(after.tiktokId).toBe(p2.tiktokId);
  });

  it("不正な形式の TikTok ID への訂正は400で、TikTokを叩かない", async () => {
    const eventId = await newEvent();
    const p = await newParticipant(eventId, "ライバー");
    const checker = stubChecker("EXISTS");

    await expect(
      updateParticipant({ eventId, participantId: p.id, patch: { tiktokId: "@@bad id!" } }, { checker })
    ).rejects.toMatchObject({ status: 400 });

    expect(checker.calls).toEqual([]);
  });

  it("TikTok上に実在しない ID への訂正は400で、room確保も起きない", async () => {
    const eventId = await newEvent();
    const p = await newParticipant(eventId, "ライバー");
    const newId = newTiktokId();

    await expect(
      updateParticipant(
        { eventId, participantId: p.id, patch: { tiktokId: newId } },
        { checker: stubChecker("MISSING") }
      )
    ).rejects.toMatchObject({ status: 400 });

    expect(await prisma.tiktokRoom.findUnique({ where: { tiktokId: newId } })).toBeNull();
    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.tiktokId).toBe(p.tiktokId);
  });

  it("チームの検証に落ちたら tiktokId も displayName も書き込まない(部分適用しない)", async () => {
    const eventId = await newEvent();
    const other = await newEvent();
    const foreignTeam = await newTeam(other, "他イベントの組");
    const p = await newParticipant(eventId, "旧ライバー");
    const newId = newTiktokId();
    const checker = stubChecker("EXISTS");

    await expect(
      updateParticipant(
        {
          eventId,
          participantId: p.id,
          patch: { tiktokId: newId, displayName: "新ライバー", teamId: foreignTeam },
        },
        { checker }
      )
    ).rejects.toMatchObject({ status: 400 });

    expect(checker.calls).toEqual([]);
    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.tiktokId).toBe(p.tiktokId);
    expect(after.displayName).toBe("旧ライバー");
  });

  it("他イベントの participantId への訂正は404で、その行を書き換えない", async () => {
    const eventId = await newEvent();
    const other = await newEvent();
    const victim = await newParticipant(other, "他イベントのライバー");
    const newId = newTiktokId();

    await expect(
      updateParticipant(
        { eventId, participantId: victim.id, patch: { tiktokId: newId } },
        { checker: stubChecker("EXISTS") }
      )
    ).rejects.toBeInstanceOf(ParticipantError);

    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: victim.id } });
    expect(after.tiktokId).toBe(victim.tiktokId);
  });

  it("finalizedAt が立っているイベントで訂正すると finalizedAt が null に戻る(再集計の固定)", async () => {
    const eventId = await newEvent();
    await prisma.event.update({ where: { id: eventId }, data: { finalizedAt: new Date() } });
    const p = await newParticipant(eventId, "ライバー");
    const newId = newTiktokId();

    await updateParticipant(
      { eventId, participantId: p.id, patch: { tiktokId: newId } },
      { checker: stubChecker("EXISTS") }
    );

    const after = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(after.finalizedAt).toBeNull();
  });

  it("同じ新IDへ異なる参加者が並行訂正すると片方は409になり、負けた側の補償が勝った側のleaseを消さない", async () => {
    const eventId = await newEvent();
    const p1 = await newParticipant(eventId, "ライバーA");
    const p2 = await newParticipant(eventId, "ライバーB");
    const newId = newTiktokId();

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
        return { verdict: "EXISTS", nickname: null, userId: null };
      },
      size: () => 0,
    };

    // p1→newId: 重複チェック(まだ誰も newId を持たない)を通過後、実在確認でブロック。
    const loser = updateParticipant(
      { eventId, participantId: p1.id, patch: { tiktokId: newId } },
      { checker: blockingChecker }
    );
    await reachedCheck;

    // p2→newId: 先に完了させる(勝者)。
    const winner = await updateParticipant(
      { eventId, participantId: p2.id, patch: { tiktokId: newId } },
      { checker: stubChecker("EXISTS") }
    );
    expect(winner.tiktokIdChanged).toBe(true);

    release();
    // p1 側は DB 書き込み時点で @@unique([eventId, tiktokId]) に当たり P2002 → 409。
    await expect(loser).rejects.toMatchObject({ status: 409 });

    // 勝者(p2)の room の監視要求が、負けた側の補償で消されていないこと。
    const room = await prisma.tiktokRoom.findUniqueOrThrow({ where: { tiktokId: newId } });
    expect(room.monitorUntil).not.toBeNull();
    expect(room.monitorUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("同一参加者への並行訂正(異なる新ID)は、後勝ち側が404になり先勝ち側のleaseを孤児化させない", async () => {
    const eventId = await newEvent();
    const p = await newParticipant(eventId, "ライバー");
    const idY = newTiktokId();
    const idZ = newTiktokId();

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
        return { verdict: "EXISTS", nickname: null, userId: null };
      },
      size: () => 0,
    };

    // p→idY: 実在確認でブロック(この時点の roomId をトランザクションの where で使う)。
    const toY = updateParticipant(
      { eventId, participantId: p.id, patch: { tiktokId: idY } },
      { checker: blockingChecker }
    );
    await reachedCheck;

    // p→idZ: 先に完了させ、p.roomId を新しい room へ進めてしまう(勝者)。
    const toZ = await updateParticipant(
      { eventId, participantId: p.id, patch: { tiktokId: idZ } },
      { checker: stubChecker("EXISTS") }
    );
    expect(toZ.tiktokIdChanged).toBe(true);

    release();
    // toY の updateMany は where に読み取り時点の旧 roomId を含むが、
    // 既に p.roomId は idZ の room へ進んでいるので count===0 → 404。
    await expect(toY).rejects.toMatchObject({ status: 404 });

    // idZ(先勝ち)側の room の監視要求が孤児化せず生きていること。
    const roomZ = await prisma.tiktokRoom.findUniqueOrThrow({ where: { tiktokId: idZ } });
    expect(roomZ.monitorUntil).not.toBeNull();
    expect(roomZ.monitorUntil!.getTime()).toBeGreaterThan(Date.now());

    const after = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.tiktokId).toBe(idZ);
  });
});
