// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { findPublicEvent, findPublicParticipantTiktokId, loadBracket } from "./public-event";

const PREFIX = "itest_pubevt";
let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;

const createdEventIds: string[] = [];

async function createEvent(
  visibility: "PUBLIC" | "PRIVATE",
  ownerUserId: string,
  format: "DIAMOND_RACE" | "TOURNAMENT" = "DIAMOND_RACE"
) {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} 公開範囲テスト`,
      ownerUserId,
      format,
      entryMode: "SOLO",
      visibility,
      startAt: new Date("2026-09-01T00:00:00.000Z"),
      endAt: new Date("2026-09-08T00:00:00.000Z"),
    },
    select: { id: true, slug: true },
  });
  createdEventIds.push(event.id);
  return event;
}

afterAll(async () => {
  for (const id of createdEventIds) {
    // EventMatch.sessionId は EventSession への Restrict FK なので、
    // 対戦 → 参加者 → 日程 → イベントの順に消す(docs/src/event/CLAUDE.md参照)。
    await prisma.eventMatch.deleteMany({ where: { eventId: id } }).catch(() => {});
    await prisma.eventParticipant.deleteMany({ where: { eventId: id } }).catch(() => {});
    await prisma.eventSession.deleteMany({ where: { eventId: id } }).catch(() => {});
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe("findPublicEvent", () => {
  it("PUBLIC は誰でも見える(未ログインでも他人でもオーナーでも)", async () => {
    const owner = `${PREFIX}_owner_${uniqueSuffix()}`;
    const event = await createEvent("PUBLIC", owner);

    expect(await findPublicEvent(event.slug)).not.toBeNull();
    expect(await findPublicEvent(event.slug, owner)).not.toBeNull();
    expect(await findPublicEvent(event.slug, `${PREFIX}_other`)).not.toBeNull();
  });

  it("PRIVATE は未ログインには見えない", async () => {
    const owner = `${PREFIX}_owner_${uniqueSuffix()}`;
    const event = await createEvent("PRIVATE", owner);

    expect(await findPublicEvent(event.slug)).toBeNull();
  });

  it("PRIVATE はオーナー以外の他人にも見えない", async () => {
    const owner = `${PREFIX}_owner_${uniqueSuffix()}`;
    const event = await createEvent("PRIVATE", owner);

    expect(await findPublicEvent(event.slug, `${PREFIX}_other_${uniqueSuffix()}`)).toBeNull();
  });

  it("PRIVATE でもオーナー自身には見える", async () => {
    const owner = `${PREFIX}_owner_${uniqueSuffix()}`;
    const event = await createEvent("PRIVATE", owner);

    const found = await findPublicEvent(event.slug, owner);
    expect(found).not.toBeNull();
    expect(found?.slug).toBe(event.slug);
  });
});

describe("findPublicParticipantTiktokId", () => {
  it("PRIVATE イベントの参加者IDは、オーナー以外には引き当てられない", async () => {
    const owner = `${PREFIX}_owner_${uniqueSuffix()}`;
    const event = await createEvent("PRIVATE", owner);
    const roomId = (
      // monitoringSuspended: true は監視対象からの隔離。Streamer 0人の部屋も watchedRoomFilter() の
      // 監視対象になったため、そのままだと並行して走る listener 系テストの getMyRooms() が
      // グローバルに claim して workerId / listenerStatus を書きに来る。集計の検証に監視は要らない。
      await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO public."TiktokRoom" (id, "tiktokId", "createdAt", "monitoringSuspended")
        VALUES (gen_random_uuid()::text, ${`${PREFIX}_room_${uniqueSuffix()}`}, NOW(), true)
        RETURNING id
      `
    )[0].id;
    const participant = await prisma.eventParticipant.create({
      data: {
        eventId: event.id,
        tiktokId: `${PREFIX}_tiktok_${uniqueSuffix()}`,
        roomId,
        displayName: "テスト参加者",
      },
      select: { id: true },
    });

    expect(await findPublicParticipantTiktokId(participant.id)).toBeNull();
    expect(await findPublicParticipantTiktokId(participant.id, `${PREFIX}_other`)).toBeNull();

    const found = await findPublicParticipantTiktokId(participant.id, owner);
    expect(found).not.toBeNull();
    expect(found?.visibility).toBe("PRIVATE");

    await prisma.eventParticipant.delete({ where: { id: participant.id } });
    await prisma.$executeRaw`DELETE FROM public."TiktokRoom" WHERE id = ${roomId}`;
  });
});

describe("loadBracket", () => {
  it("hasLiveStreamer は SCHEDULED の対戦でだけ、配信中(listenerActivity='live')の出場者がいるサイドに立つ", async () => {
    const owner = `${PREFIX}_owner_${uniqueSuffix()}`;
    const event = await createEvent("PUBLIC", owner, "TOURNAMENT");
    const session = await prisma.eventSession.create({
      data: {
        eventId: event.id,
        startAt: new Date("2026-09-01T00:00:00.000Z"),
        endAt: new Date("2026-09-08T00:00:00.000Z"),
      },
      select: { id: true },
    });

    async function makeParticipant(activity: string) {
      const room = (
        // monitoringSuspended: true は監視対象からの隔離。Streamer 0人の部屋も watchedRoomFilter() の
        // 監視対象になったため、そのままだと並行して走る listener 系テストの getMyRooms() が
        // グローバルに claim して listenerActivity を上書きしうる（ここで固定した live/offline が壊れる）。
        await prisma.$queryRaw<{ id: string }[]>`
          INSERT INTO public."TiktokRoom" (id, "tiktokId", "listenerActivity", "createdAt", "monitoringSuspended")
          VALUES (gen_random_uuid()::text, ${`${PREFIX}_room_${uniqueSuffix()}`}, ${activity}, NOW(), true)
          RETURNING id
        `
      )[0].id;
      const participant = await prisma.eventParticipant.create({
        data: {
          eventId: event.id,
          tiktokId: `${PREFIX}_tiktok_${uniqueSuffix()}`,
          roomId: room,
          displayName: "テスト配信者",
        },
        select: { id: true },
      });
      return { participantId: participant.id, roomId: room };
    }

    const live = await makeParticipant("live");
    const offline = await makeParticipant("offline");

    const match = await prisma.eventMatch.create({
      data: {
        eventId: event.id,
        sessionId: session.id,
        round: 1,
        bracketPosition: 0,
        status: "SCHEDULED",
        sides: {
          create: [
            { sideIndex: 0, participants: { create: [{ participantId: live.participantId }] } },
            { sideIndex: 1, participants: { create: [{ participantId: offline.participantId }] } },
          ],
        },
      },
      select: { id: true },
    });

    const scheduled = await loadBracket(event.id);
    const scheduledSides = scheduled?.matches[0]?.sides ?? [];
    expect(scheduledSides.find((s) => s.sideIndex === 0)?.hasLiveStreamer).toBe(true);
    expect(scheduledSides.find((s) => s.sideIndex === 1)?.hasLiveStreamer).toBe(false);

    // バトル中(SCHEDULEDでない)に進んだら、配信中でも発光の対象にしない。
    await prisma.eventMatch.update({ where: { id: match.id }, data: { status: "LIVE" } });
    const live_ = await loadBracket(event.id);
    const liveSides = live_?.matches[0]?.sides ?? [];
    expect(liveSides.every((s) => !s.hasLiveStreamer)).toBe(true);

    await prisma.$executeRaw`DELETE FROM public."TiktokRoom" WHERE id IN (${live.roomId}, ${offline.roomId})`;
  });
});
