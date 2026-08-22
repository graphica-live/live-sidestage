// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { findPublicEvent, findPublicParticipantTiktokId } from "./public-event";

const PREFIX = "itest_pubevt";
let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;

const createdEventIds: string[] = [];

async function createEvent(visibility: "PUBLIC" | "PRIVATE", ownerUserId: string) {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} 公開範囲テスト`,
      ownerUserId,
      format: "DIAMOND_RACE",
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
      await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO public."TiktokRoom" (id, "tiktokId", "createdAt")
        VALUES (gen_random_uuid()::text, ${`${PREFIX}_room_${uniqueSuffix()}`}, NOW())
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
