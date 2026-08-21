// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// public.gifts を直接読むので、`npm run db:push:local` 済みのDBが要る。
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  AGGREGATE_GRACE_MS,
  aggregateEvent,
  aggregationWindow,
  advisoryLockKey,
  MAX_CONTRIBUTION_ROWS,
} from "./aggregate";

const PREFIX = "itest_agg";
const START = new Date("2026-09-01T00:00:00.000Z");
const END = new Date("2026-09-08T00:00:00.000Z");

let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;

async function createRoom(tiktokId: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO public."TiktokRoom" (id, "tiktokId", "createdAt")
    VALUES (gen_random_uuid()::text, ${tiktokId}, NOW())
    RETURNING id
  `;
  return rows[0].id;
}

async function insertGift(params: {
  roomId: string;
  uniqueId: string;
  diamonds: number;
  receivedAt: Date;
  repeatCount?: number;
  nickname?: string;
}) {
  await prisma.$executeRaw`
    INSERT INTO public.gifts
      (id, "roomId", "uniqueId", nickname, "giftId", "giftName", "repeatCount",
       "diamondCount", "totalDiamonds", "receivedAt", "dayKey", "orderId")
    VALUES
      (gen_random_uuid()::text, ${params.roomId}, ${params.uniqueId},
       ${params.nickname ?? params.uniqueId}, 5, 'Rose', ${params.repeatCount ?? 1},
       ${params.diamonds}, ${params.diamonds}, ${params.receivedAt}, '2026-09-01',
       ${`${PREFIX}_${uniqueSuffix()}`})
  `;
}

async function createEvent(overrides: {
  entryMode?: string;
  status?: string;
  startAt?: Date;
  endAt?: Date;
} = {}) {
  return prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} 集計テスト`,
      ownerUserId: `${PREFIX}_owner`,
      format: "DIAMOND_RACE",
      entryMode: overrides.entryMode ?? "SOLO",
      status: overrides.status ?? "RUNNING",
      startAt: overrides.startAt ?? START,
      endAt: overrides.endAt ?? END,
    },
    select: { id: true },
  });
}

async function addParticipant(
  eventId: string,
  tiktokId: string,
  teamId?: string
): Promise<{ id: string; roomId: string }> {
  const roomId = await createRoom(tiktokId);
  const p = await prisma.eventParticipant.create({
    data: { eventId, tiktokId, roomId, displayName: tiktokId, teamId: teamId ?? null },
    select: { id: true },
  });
  return { id: p.id, roomId };
}

const createdEventIds: string[] = [];
const createdRoomIds: string[] = [];

async function newEvent(overrides = {}) {
  const e = await createEvent(overrides);
  createdEventIds.push(e.id);
  return e;
}

async function newParticipant(eventId: string, tiktokId: string, teamId?: string) {
  const p = await addParticipant(eventId, `${PREFIX}_${tiktokId}_${uniqueSuffix()}`, teamId);
  createdRoomIds.push(p.roomId);
  return p;
}

beforeEach(() => {
  seq = 0;
});

afterAll(async () => {
  // gifts は room の cascade で消える。イベント配下も cascade。
  for (const id of createdEventIds) {
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdRoomIds) {
    await prisma.$executeRaw`DELETE FROM public."TiktokRoom" WHERE id = ${id}`.catch(() => {});
  }
  await prisma.$disconnect();
});

describe("aggregateEvent", () => {
  it("参加者ごと・イベント全体のリスナー貢献と順位表を作る", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    const at = new Date("2026-09-02T12:00:00.000Z");
    await insertGift({ roomId: a.roomId, uniqueId: "listener1", diamonds: 100, receivedAt: at });
    await insertGift({ roomId: a.roomId, uniqueId: "listener2", diamonds: 50, receivedAt: at });
    await insertGift({ roomId: b.roomId, uniqueId: "listener1", diamonds: 30, receivedAt: at });

    const result = await aggregateEvent(event.id);
    expect(result.status).toBe("done");

    const standings = await prisma.eventStanding.findMany({
      where: { eventId: event.id, subjectType: "PARTICIPANT" },
      orderBy: { rank: "asc" },
    });
    expect(standings).toHaveLength(2);
    expect(standings[0].subjectId).toBe(a.id);
    expect(standings[0].diamonds).toBe(150n);
    expect(standings[0].rank).toBe(1);
    expect(standings[1].subjectId).toBe(b.id);
    expect(standings[1].diamonds).toBe(30n);
    expect(standings[1].rank).toBe(2);

    // イベント全体では listener1 が 100 + 30 = 130 でトップ
    const eventScope = await prisma.eventContribution.findMany({
      where: { eventId: event.id, scope: "EVENT" },
      orderBy: { diamonds: "desc" },
    });
    expect(eventScope.map((c) => [c.listenerUniqueId, c.diamonds])).toEqual([
      ["listener1", 130n],
      ["listener2", 50n],
    ]);

    // 参加者スコープは各自のぶんだけ
    const forA = await prisma.eventContribution.findMany({
      where: { eventId: event.id, scope: "PARTICIPANT", scopeId: a.id },
      orderBy: { diamonds: "desc" },
    });
    expect(forA.map((c) => [c.listenerUniqueId, c.diamonds])).toEqual([
      ["listener1", 100n],
      ["listener2", 50n],
    ]);
  });

  it("期間外(半開区間の外)のギフトは集計されない", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");

    await insertGift({
      roomId: a.roomId,
      uniqueId: "before",
      diamonds: 1000,
      receivedAt: new Date(START.getTime() - 1),
    });
    await insertGift({ roomId: a.roomId, uniqueId: "at_start", diamonds: 10, receivedAt: START });
    // endAt ちょうどは含まない
    await insertGift({ roomId: a.roomId, uniqueId: "at_end", diamonds: 2000, receivedAt: END });

    await aggregateEvent(event.id);

    const rows = await prisma.eventContribution.findMany({
      where: { eventId: event.id, scope: "EVENT" },
    });
    expect(rows.map((r) => r.listenerUniqueId)).toEqual(["at_start"]);
    expect(rows[0].diamonds).toBe(10n);
  });

  it("倍率を適用したポイントを出す。実弾(ダイヤ)は倍率の影響を受けない", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");

    await prisma.eventMultiplier.create({
      data: { eventId: event.id, kind: "SOLO_STREAM", factor: "2.5" },
    });

    await insertGift({
      roomId: a.roomId,
      uniqueId: "listener1",
      diamonds: 100,
      receivedAt: new Date("2026-09-02T12:00:00.000Z"),
    });

    await aggregateEvent(event.id);

    const row = await prisma.eventContribution.findFirst({
      where: { eventId: event.id, scope: "EVENT" },
    });
    expect(row?.diamonds).toBe(100n);
    expect(row?.points.toString()).toBe("250");

    const standing = await prisma.eventStanding.findFirst({
      where: { eventId: event.id, subjectType: "PARTICIPANT" },
    });
    expect(standing?.diamonds).toBe(100n);
    expect(standing?.points.toString()).toBe("250");
  });

  it("期間限定の倍率は、その区間のギフトにだけ効く", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");

    await prisma.eventMultiplier.create({
      data: {
        eventId: event.id,
        kind: "SOLO_STREAM",
        factor: "3",
        startAt: new Date("2026-09-03T00:00:00.000Z"),
        endAt: new Date("2026-09-04T00:00:00.000Z"),
      },
    });

    // 倍率区間の中と外に1件ずつ
    await insertGift({
      roomId: a.roomId,
      uniqueId: "inside",
      diamonds: 100,
      receivedAt: new Date("2026-09-03T12:00:00.000Z"),
    });
    await insertGift({
      roomId: a.roomId,
      uniqueId: "outside",
      diamonds: 100,
      receivedAt: new Date("2026-09-05T12:00:00.000Z"),
    });

    await aggregateEvent(event.id);

    const rows = await prisma.eventContribution.findMany({
      where: { eventId: event.id, scope: "EVENT" },
    });
    const byListener = new Map(rows.map((r) => [r.listenerUniqueId, r]));
    expect(byListener.get("inside")?.points.toString()).toBe("300");
    expect(byListener.get("outside")?.points.toString()).toBe("100");
    // 実弾は同じ
    expect(byListener.get("inside")?.diamonds).toBe(100n);
    expect(byListener.get("outside")?.diamonds).toBe(100n);
  });

  it("チーム戦では所属参加者全員のダイヤを合算して順位をつける", async () => {
    const event = await newEvent({ entryMode: "TEAM" });
    const red = await prisma.eventTeam.create({
      data: { eventId: event.id, name: "赤組" },
      select: { id: true },
    });
    const blue = await prisma.eventTeam.create({
      data: { eventId: event.id, name: "青組" },
      select: { id: true },
    });

    const a = await newParticipant(event.id, "a", red.id);
    const b = await newParticipant(event.id, "b", red.id);
    const c = await newParticipant(event.id, "c", blue.id);

    const at = new Date("2026-09-02T12:00:00.000Z");
    await insertGift({ roomId: a.roomId, uniqueId: "l1", diamonds: 40, receivedAt: at });
    await insertGift({ roomId: b.roomId, uniqueId: "l1", diamonds: 30, receivedAt: at });
    await insertGift({ roomId: c.roomId, uniqueId: "l2", diamonds: 60, receivedAt: at });

    await aggregateEvent(event.id);

    const teams = await prisma.eventStanding.findMany({
      where: { eventId: event.id, subjectType: "TEAM" },
      orderBy: { rank: "asc" },
    });
    expect(teams).toHaveLength(2);
    expect(teams[0].subjectId).toBe(red.id); // 40 + 30 = 70
    expect(teams[0].diamonds).toBe(70n);
    expect(teams[1].subjectId).toBe(blue.id); // 60
    expect(teams[1].diamonds).toBe(60n);

    // チームスコープの貢献は、そのチームに投げたリスナーだけ
    const redContrib = await prisma.eventContribution.findMany({
      where: { eventId: event.id, scope: "TEAM", scopeId: red.id },
    });
    expect(redContrib.map((r) => [r.listenerUniqueId, r.diamonds])).toEqual([["l1", 70n]]);
  });

  it("再集計は冪等で、2回流しても値が増えない", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    await insertGift({
      roomId: a.roomId,
      uniqueId: "listener1",
      diamonds: 100,
      receivedAt: new Date("2026-09-02T12:00:00.000Z"),
    });

    await aggregateEvent(event.id);
    await aggregateEvent(event.id);

    const rows = await prisma.eventContribution.findMany({
      where: { eventId: event.id, scope: "EVENT" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].diamonds).toBe(100n);

    const standings = await prisma.eventStanding.findMany({ where: { eventId: event.id } });
    expect(standings).toHaveLength(1);
    expect(standings[0].diamonds).toBe(100n);
  });

  it("参加者を外すと、その参加者ぶんが次の集計で消える", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    const at = new Date("2026-09-02T12:00:00.000Z");
    await insertGift({ roomId: a.roomId, uniqueId: "l1", diamonds: 100, receivedAt: at });
    await insertGift({ roomId: b.roomId, uniqueId: "l1", diamonds: 50, receivedAt: at });

    await aggregateEvent(event.id);
    expect(
      (await prisma.eventContribution.findFirst({ where: { eventId: event.id, scope: "EVENT" } }))
        ?.diamonds
    ).toBe(150n);

    await prisma.eventParticipant.delete({ where: { id: b.id } });
    await aggregateEvent(event.id);

    const eventScope = await prisma.eventContribution.findFirst({
      where: { eventId: event.id, scope: "EVENT" },
    });
    expect(eventScope?.diamonds).toBe(100n); // b のぶんが消える

    const standings = await prisma.eventStanding.findMany({ where: { eventId: event.id } });
    expect(standings).toHaveLength(1);
    expect(standings[0].subjectId).toBe(a.id);
  });

  it("参加者が全員いなくなったらスナップショットも空になる", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    await insertGift({
      roomId: a.roomId,
      uniqueId: "l1",
      diamonds: 100,
      receivedAt: new Date("2026-09-02T12:00:00.000Z"),
    });

    await aggregateEvent(event.id);
    expect(await prisma.eventContribution.count({ where: { eventId: event.id } })).toBeGreaterThan(0);

    await prisma.eventParticipant.delete({ where: { id: a.id } });
    const result = await aggregateEvent(event.id);

    expect(result).toMatchObject({ status: "skipped", reason: "no-participants" });
    expect(await prisma.eventContribution.count({ where: { eventId: event.id } })).toBe(0);
    expect(await prisma.eventStanding.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("リスナー貢献の保存は上限件数で打ち切られるが、順位表の合計は全ギフトぶんになる", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");

    const at = new Date("2026-09-02T12:00:00.000Z");
    const extra = 5;
    for (let i = 0; i < MAX_CONTRIBUTION_ROWS + extra; i++) {
      await insertGift({ roomId: a.roomId, uniqueId: `l${i}`, diamonds: i + 1, receivedAt: at });
    }

    await aggregateEvent(event.id);

    const saved = await prisma.eventContribution.count({
      where: { eventId: event.id, scope: "EVENT" },
    });
    expect(saved).toBe(MAX_CONTRIBUTION_ROWS);

    // 合計は切り捨て前の全件から計算されている
    const total = Array.from({ length: MAX_CONTRIBUTION_ROWS + extra }, (_, i) => i + 1).reduce(
      (s, n) => s + n,
      0
    );
    const standing = await prisma.eventStanding.findFirst({ where: { eventId: event.id } });
    expect(standing?.diamonds).toBe(BigInt(total));
  });

  it("giftCount はレコード数ではなく repeatCount の合計になる", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const at = new Date("2026-09-02T12:00:00.000Z");

    await insertGift({
      roomId: a.roomId,
      uniqueId: "l1",
      diamonds: 50,
      receivedAt: at,
      repeatCount: 10,
    });
    await insertGift({
      roomId: a.roomId,
      uniqueId: "l1",
      diamonds: 5,
      receivedAt: at,
      repeatCount: 1,
    });

    await aggregateEvent(event.id);

    const row = await prisma.eventContribution.findFirst({
      where: { eventId: event.id, scope: "EVENT" },
    });
    expect(row?.giftCount).toBe(11);
  });
});

describe("最終集計(finalizedAt)", () => {
  it("締切前ならFINISHEDにしても集計対象に残る", async () => {
    const event = await newEvent({
      status: "FINISHED",
      startAt: new Date(Date.now() - 86_400_000),
      endAt: new Date(Date.now() + 60_000),
    });

    const due = await prisma.event.findMany({
      where: { ...aggregationWindow(new Date()), id: event.id },
      select: { id: true },
    });
    expect(due.map((e) => e.id)).toContain(event.id);
  });

  it("締切を過ぎた集計でfinalizedAtが立ち、以後は集計対象から外れる", async () => {
    // すでに終了して猶予も過ぎているイベント
    const endAt = new Date(Date.now() - AGGREGATE_GRACE_MS - 60_000);
    const event = await newEvent({
      status: "FINISHED",
      startAt: new Date(endAt.getTime() - 86_400_000),
      endAt,
    });
    const a = await newParticipant(event.id, "a");
    await insertGift({
      roomId: a.roomId,
      uniqueId: "l1",
      diamonds: 100,
      receivedAt: new Date(endAt.getTime() - 3600_000),
    });

    // 締切後なので、この集計が最終集計になる
    const before = await prisma.event.findUnique({
      where: { id: event.id },
      select: { finalizedAt: true },
    });
    expect(before?.finalizedAt).toBeNull();

    const result = await aggregateEvent(event.id);
    expect(result.status).toBe("done");

    const after = await prisma.event.findUnique({
      where: { id: event.id },
      select: { finalizedAt: true },
    });
    expect(after?.finalizedAt).not.toBeNull();

    // 集計結果は残る
    expect(await prisma.eventContribution.count({ where: { eventId: event.id } })).toBeGreaterThan(0);

    // 以後は対象から外れる
    const due = await prisma.event.findMany({
      where: { ...aggregationWindow(new Date()), id: event.id },
      select: { id: true },
    });
    expect(due).toHaveLength(0);
  });

  it("開催中(締切前)の集計ではfinalizedAtは立たない", async () => {
    const event = await newEvent({
      startAt: new Date(Date.now() - 86_400_000),
      endAt: new Date(Date.now() + 86_400_000),
    });
    await newParticipant(event.id, "a");

    await aggregateEvent(event.id);

    const after = await prisma.event.findUnique({
      where: { id: event.id },
      select: { finalizedAt: true },
    });
    expect(after?.finalizedAt).toBeNull();
  });

  it("開始前(startAt が未来)のイベントは集計対象にならない", async () => {
    const event = await newEvent({
      startAt: new Date(Date.now() + 86_400_000),
      endAt: new Date(Date.now() + 2 * 86_400_000),
    });

    const due = await prisma.event.findMany({
      where: { ...aggregationWindow(new Date()), id: event.id },
      select: { id: true },
    });
    expect(due).toHaveLength(0);
  });
});

describe("0点の扱い", () => {
  it("ギフトが1件もない参加者も0点で順位表に載る", async () => {
    const event = await newEvent();
    const a = await newParticipant(event.id, "a");
    const b = await newParticipant(event.id, "b");

    await insertGift({
      roomId: a.roomId,
      uniqueId: "l1",
      diamonds: 100,
      receivedAt: new Date("2026-09-02T12:00:00.000Z"),
    });

    await aggregateEvent(event.id);

    const standings = await prisma.eventStanding.findMany({
      where: { eventId: event.id, subjectType: "PARTICIPANT" },
      orderBy: { rank: "asc" },
    });
    expect(standings).toHaveLength(2);
    expect(standings[1].subjectId).toBe(b.id);
    expect(standings[1].diamonds).toBe(0n);
    expect(standings[1].rank).toBe(2);
  });

  it("参加者が1人もいないチームも0点で順位表に載る", async () => {
    const event = await newEvent({ entryMode: "TEAM" });
    const red = await prisma.eventTeam.create({
      data: { eventId: event.id, name: "赤組" },
      select: { id: true },
    });
    const empty = await prisma.eventTeam.create({
      data: { eventId: event.id, name: "空組" },
      select: { id: true },
    });

    const a = await newParticipant(event.id, "a", red.id);
    await insertGift({
      roomId: a.roomId,
      uniqueId: "l1",
      diamonds: 100,
      receivedAt: new Date("2026-09-02T12:00:00.000Z"),
    });

    await aggregateEvent(event.id);

    const teams = await prisma.eventStanding.findMany({
      where: { eventId: event.id, subjectType: "TEAM" },
      orderBy: { rank: "asc" },
    });
    expect(teams).toHaveLength(2);
    expect(teams[1].subjectId).toBe(empty.id);
    expect(teams[1].diamonds).toBe(0n);
  });

  it("全員0点なら全員が同順位になる", async () => {
    const event = await newEvent();
    await newParticipant(event.id, "a");
    await newParticipant(event.id, "b");

    await aggregateEvent(event.id);

    const standings = await prisma.eventStanding.findMany({
      where: { eventId: event.id, subjectType: "PARTICIPANT" },
    });
    expect(standings).toHaveLength(2);
    expect(standings.every((s) => s.rank === 1)).toBe(true);
    expect(standings.every((s) => s.diamonds === 0n)).toBe(true);
  });

  it("チーム戦で未所属の参加者はチーム順位に含まれない(参加者順位には出る)", async () => {
    const event = await newEvent({ entryMode: "TEAM" });
    const red = await prisma.eventTeam.create({
      data: { eventId: event.id, name: "赤組" },
      select: { id: true },
    });

    const a = await newParticipant(event.id, "a", red.id);
    const loner = await newParticipant(event.id, "loner"); // teamId なし

    const at = new Date("2026-09-02T12:00:00.000Z");
    await insertGift({ roomId: a.roomId, uniqueId: "l1", diamonds: 50, receivedAt: at });
    await insertGift({ roomId: loner.roomId, uniqueId: "l2", diamonds: 999, receivedAt: at });

    await aggregateEvent(event.id);

    const teams = await prisma.eventStanding.findMany({
      where: { eventId: event.id, subjectType: "TEAM" },
    });
    // 未所属のダイヤはどのチームにも入らない
    expect(teams).toHaveLength(1);
    expect(teams[0].diamonds).toBe(50n);

    // 参加者単位では残る
    const participants = await prisma.eventStanding.findMany({
      where: { eventId: event.id, subjectType: "PARTICIPANT" },
    });
    expect(participants).toHaveLength(2);

    // イベント全体のリスナーランキングには両方入る
    const eventScope = await prisma.eventContribution.findMany({
      where: { eventId: event.id, scope: "EVENT" },
    });
    expect(eventScope).toHaveLength(2);
  });
});

describe("advisoryLockKey", () => {
  it("同じIDから常に同じキーを作る", () => {
    expect(advisoryLockKey("abc")).toBe(advisoryLockKey("abc"));
    expect(advisoryLockKey("abc")).not.toBe(advisoryLockKey("abd"));
  });

  it("PostgreSQL の bigint の範囲に収まる", () => {
    for (const id of ["a", "cmt2cjsoh0000a5gac7bx1rfr", "x".repeat(64)]) {
      const key = advisoryLockKey(id);
      expect(key).toBeGreaterThanOrEqual(-(2n ** 63n));
      expect(key).toBeLessThan(2n ** 63n);
    }
  });
});
