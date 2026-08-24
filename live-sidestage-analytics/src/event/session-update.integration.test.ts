// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// 日程の差分更新。**対戦が日程を参照している**ので、ここが全置換に戻ると
// 対戦の割り当てが壊れる(あるいは外部キーで保存できなくなる)。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { applySessionDiff, SessionUpdateError } from "./session-update";
import type { NormalizedSession } from "./sessions";

const PREFIX = "itest_sesupd";
const NOW = Date.now();
const START = new Date(NOW - 3 * 86_400_000);
const END = new Date(NOW + 3 * 86_400_000);
const DAY1_START = new Date(NOW - 2 * 86_400_000);
const DAY1_END = new Date(DAY1_START.getTime() + 3_600_000);

let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;
const createdEventIds: string[] = [];
const createdRoomIds: string[] = [];

async function newEvent() {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} イベント`,
      ownerUserId: `${PREFIX}_owner`,
      format: "DEATHMATCH",
      entryMode: "SOLO",
      status: "RUNNING",
      startAt: START,
      endAt: END,
      sessions: { create: [{ name: "1日目", startAt: DAY1_START, endAt: DAY1_END }] },
    },
    select: { id: true, sessions: { select: { id: true } } },
  });
  createdEventIds.push(event.id);
  return { id: event.id, sessionId: event.sessions[0].id };
}

async function newParticipant(eventId: string, name: string) {
  const tiktokId = `${PREFIX}_${name}_${uniqueSuffix()}`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO public."TiktokRoom" (id, "tiktokId", "createdAt")
    VALUES (gen_random_uuid()::text, ${tiktokId}, NOW())
    RETURNING id
  `;
  createdRoomIds.push(rows[0].id);
  const p = await prisma.eventParticipant.create({
    data: { eventId, tiktokId, roomId: rows[0].id, displayName: name },
    select: { id: true },
  });
  return { id: p.id, roomId: rows[0].id };
}

/** 対戦を1件、指定の日程へ作る。 */
async function newMatch(eventId: string, sessionId: string, status = "SCHEDULED") {
  return prisma.eventMatch.create({
    data: { eventId, sessionId, status, scheduledStartAt: DAY1_START, scheduledEndAt: DAY1_END },
    select: { id: true },
  });
}

const session = (input: Partial<NormalizedSession>): NormalizedSession => ({
  id: null,
  name: null,
  startAt: DAY1_START,
  endAt: DAY1_END,
  ...input,
});

afterAll(async () => {
  for (const id of createdEventIds) {
    await prisma.eventMatch.deleteMany({ where: { eventId: id } }).catch(() => {});
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdRoomIds) {
    await prisma.$executeRaw`DELETE FROM public."TiktokRoom" WHERE id = ${id}`.catch(() => {});
  }
  await prisma.$disconnect();
});

describe("applySessionDiff", () => {
  it("id を送れば日程の id を保ったまま時刻を更新する", async () => {
    const event = await newEvent();
    const match = await newMatch(event.id, event.sessionId);

    const nextEnd = new Date(DAY1_END.getTime() + 3_600_000);
    await prisma.$transaction((tx) =>
      applySessionDiff(tx, event.id, [
        session({ id: event.sessionId, name: "1日目", endAt: nextEnd }),
      ])
    );

    const sessions = await prisma.eventSession.findMany({ where: { eventId: event.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(event.sessionId);
    expect(sessions[0].endAt.toISOString()).toBe(nextEnd.toISOString());

    // 対戦の割り当ては動かない。旧列も新しい窓へ揃う(ローリング更新中の旧コード向け)。
    const after = await prisma.eventMatch.findUniqueOrThrow({ where: { id: match.id } });
    expect(after.sessionId).toBe(event.sessionId);
    expect(after.scheduledEndAt?.toISOString()).toBe(nextEnd.toISOString());
  });

  it("id を持たない行は新しい日程として足す", async () => {
    const event = await newEvent();
    const day2Start = new Date(DAY1_START.getTime() + 86_400_000);

    await prisma.$transaction((tx) =>
      applySessionDiff(tx, event.id, [
        session({ id: event.sessionId, name: "1日目" }),
        session({
          name: "2日目",
          startAt: day2Start,
          endAt: new Date(day2Start.getTime() + 3_600_000),
        }),
      ])
    );

    const sessions = await prisma.eventSession.findMany({
      where: { eventId: event.id },
      orderBy: { startAt: "asc" },
    });
    expect(sessions.map((s) => s.name)).toEqual(["1日目", "2日目"]);
    expect(sessions[0].id).toBe(event.sessionId);
  });

  it("対戦がぶら下がっている日程は消せない", async () => {
    const event = await newEvent();
    await newMatch(event.id, event.sessionId);

    // 送られてこなかった既存日程 = 削除対象。
    await expect(
      prisma.$transaction((tx) => applySessionDiff(tx, event.id, [session({})]))
    ).rejects.toMatchObject({ code: "SESSION_IN_USE" });
  });

  it("VOID の対戦でも日程の削除は止める(参照が残っているため)", async () => {
    const event = await newEvent();
    await newMatch(event.id, event.sessionId, "VOID");

    await expect(
      prisma.$transaction((tx) => applySessionDiff(tx, event.id, [session({})]))
    ).rejects.toMatchObject({ code: "SESSION_IN_USE" });
  });

  it("このイベントに無い日程 id は拒否する", async () => {
    const event = await newEvent();
    const other = await newEvent();

    await expect(
      prisma.$transaction((tx) =>
        applySessionDiff(tx, event.id, [session({ id: other.sessionId })])
      )
    ).rejects.toMatchObject({ code: "UNKNOWN_SESSION" });
  });

  it("検知済みの対戦が外に出る縮め方は拒否する", async () => {
    const event = await newEvent();
    const detectedStart = new Date(DAY1_START.getTime() + 30 * 60_000);
    const detectedEnd = new Date(DAY1_START.getTime() + 40 * 60_000);
    await prisma.eventMatch.create({
      data: {
        eventId: event.id,
        sessionId: event.sessionId,
        status: "DETECTED",
        detectedBattleId: `${PREFIX}_b_${uniqueSuffix()}`,
        detectedStartAt: detectedStart,
        detectedEndAt: detectedEnd,
        decidedAt: detectedEnd,
      },
    });

    await expect(
      prisma.$transaction((tx) =>
        applySessionDiff(tx, event.id, [
          session({
            id: event.sessionId,
            endAt: new Date(DAY1_START.getTime() + 20 * 60_000),
          }),
        ])
      )
    ).rejects.toBeInstanceOf(SessionUpdateError);
  });

  it("検知していない対戦なら日程を縮められる", async () => {
    const event = await newEvent();
    await newMatch(event.id, event.sessionId);

    const shorter = new Date(DAY1_START.getTime() + 20 * 60_000);
    await expect(
      prisma.$transaction((tx) =>
        applySessionDiff(tx, event.id, [session({ id: event.sessionId, endAt: shorter })])
      )
    ).resolves.toBeUndefined();
  });
});
