// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// 参加者の部分更新(表示名・所属チーム)。守りたいのは2つ。
//   1. 検証に失敗したときに**片方だけ書き込まれない**こと(部分適用の禁止)
//   2. 改名が `tiktokId` / `roomId` / lease に一切触れないこと
//      (触ると TikTok 接続の同一性と集計の紐付けが壊れる)
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ParticipantError, updateParticipant } from "./participants";

const PREFIX = "itest_prtupd";
const NOW = Date.now();
const START = new Date(NOW - 86_400_000);
const END = new Date(NOW + 86_400_000);

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
 * `TiktokRoom.monitorUntil` は**立てない**（`session-update.integration.test.ts` と同じ）。
 * 未来の期限を入れると `watchedRoomFilter()` の監視対象になり、並行して走る
 * listener 系テストの `getMyRooms()` が未割当の監視対象を**グローバルに**claim して
 * `workerId` を書きに来る。改名の検証には要らないので、共有プールへ足さない。
 */
async function newParticipant(eventId: string, displayName: string, handle?: string) {
  const tiktokId = handle ?? `${PREFIX}_${uniqueSuffix()}`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO public."TiktokRoom" (id, "tiktokId", "createdAt")
    VALUES (gen_random_uuid()::text, ${tiktokId}, NOW())
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

afterAll(async () => {
  for (const id of createdEventIds) {
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdRoomIds) {
    await prisma.$executeRaw`DELETE FROM public."TiktokRoom" WHERE id = ${id}`.catch(() => {});
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
