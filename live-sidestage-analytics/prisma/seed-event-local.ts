// イベント機能のローカル確認用シードデータ。`npm run seed:event:local` で実行する。
// Railwayの共有DBには一切触れない(.env.local.test の DATABASE_URL のみを使う)。
//
//   docker compose up -d db
//   npm run db:push:local && npm run seed:event:local
//
// analytics 本体のシード(seed-local.ts)とは独立して流せる。開発用ユーザーは
// どちらも dev@local.test を upsert するので、両方流しても1人に収束する。
import { prisma } from "../src/lib/prisma";

const SEED_OWNER_EMAIL = "dev@local.test";

function jstDateKey(date: Date): string {
  return new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("localhost") && !url.includes("127.0.0.1")) {
    throw new Error(`seed-event-local はローカルDB専用。DATABASE_URL が localhost ではない: ${url}`);
  }

  const owner = await prisma.user.upsert({
    where: { email: SEED_OWNER_EMAIL },
    update: {},
    create: { name: "dev", email: SEED_OWNER_EMAIL },
    select: { id: true },
  });
  const ownerUserId = owner.id;

  const now = Date.now();

  const race = await prisma.event.upsert({
    where: { slug: "seed-diamond-race" },
    update: {},
    create: {
      slug: "seed-diamond-race",
      title: "シード用 獲得ダイヤレース",
      description: "ローカル確認用のイベント。",
      ownerUserId,
      format: "DIAMOND_RACE",
      entryMode: "TEAM",
      teamPreset: "PREFECTURE",
      visibility: "UNLISTED",
      status: "RUNNING",
      startAt: new Date(now - 24 * 3600_000),
      endAt: new Date(now + 6 * 24 * 3600_000),
      // 通しで1日程のイベント。外枠と一致する。
      sessions: {
        create: [
          { startAt: new Date(now - 24 * 3600_000), endAt: new Date(now + 6 * 24 * 3600_000) },
        ],
      },
    },
  });

  const draft = await prisma.event.upsert({
    where: { slug: "seed-tournament-draft" },
    update: {},
    create: {
      slug: "seed-tournament-draft",
      title: "シード用 バトルトーナメント(下書き)",
      ownerUserId,
      format: "TOURNAMENT",
      entryMode: "SOLO",
      visibility: "UNLISTED",
      status: "DRAFT",
      // 外枠は全日程を覆う。集計されるのは下の2日程の中だけで、
      // 1日目の終了〜2日目の開始のギフトは入らない。
      startAt: new Date(now + 7 * 24 * 3600_000),
      endAt: new Date(now + 8 * 24 * 3600_000 + 3600_000),
      sessions: {
        create: [
          {
            name: "予選",
            startAt: new Date(now + 7 * 24 * 3600_000),
            endAt: new Date(now + 7 * 24 * 3600_000 + 3600_000),
          },
          {
            name: "決勝",
            startAt: new Date(now + 8 * 24 * 3600_000),
            endAt: new Date(now + 8 * 24 * 3600_000 + 3600_000),
          },
        ],
      },
    },
  });

  await seedRaceEntries(race.id, race.startAt, race.endAt);

  console.log("seeded:", { ownerUserId, race: race.slug, draft: draft.slug });
  console.log("集計を流すには: npm run event-worker:local");
}

// 公開ページとランキングの確認用に、チーム・参加者・ギフトを入れる。
async function seedRaceEntries(eventId: string, startAt: Date, endAt: Date) {
  if ((await prisma.eventParticipant.count({ where: { eventId } })) > 0) return;

  const teams = [
    { name: "東京都", prefectureCode: "13", colorHex: "#fe2c55" },
    { name: "大阪府", prefectureCode: "27", colorHex: "#4a9eff" },
    { name: "北海道", prefectureCode: "01", colorHex: "#4ade80" },
  ];

  const teamIds: string[] = [];
  for (const [i, team] of teams.entries()) {
    const created = await prisma.eventTeam.create({
      data: { eventId, ...team, sortOrder: i },
      select: { id: true },
    });
    teamIds.push(created.id);
  }

  // 倍率オプションの確認用。前半だけポイント2倍にして、pt と実弾に差が出るようにする。
  // 下のギフト時刻の分布(期間の 1/15 〜 1/10 あたりから始まる)に重なる範囲にすること。
  await prisma.eventMultiplier.create({
    data: {
      eventId,
      kind: "SOLO_STREAM",
      factor: "2",
      startAt,
      endAt: new Date(startAt.getTime() + (endAt.getTime() - startAt.getTime()) / 4),
    },
  });

  const listeners = ["hikari_fan", "aoi_supporter", "kenta1234", "momo_love", "yuki_no_hana"];

  for (let i = 0; i < 6; i++) {
    const tiktokId = `seed_liver_${i + 1}`;
    const room = await prisma.tiktokRoom.upsert({
      where: { tiktokId },
      update: {},
      create: { tiktokId },
      select: { id: true },
    });

    await prisma.eventParticipant.create({
      data: {
        eventId,
        tiktokId,
        roomId: room.id,
        displayName: `シード配信者${i + 1}`,
        teamId: teamIds[i % teamIds.length],
      },
    });

    // 参加者ごとに件数と金額を変えて順位に差を出す。
    for (let g = 0; g < 5 + i; g++) {
      const listener = listeners[(i + g) % listeners.length];
      const at = new Date(
        startAt.getTime() + ((g + 1) * (endAt.getTime() - startAt.getTime())) / (10 + i)
      );
      // orderId で冪等にする。再実行しても件数が増えない。
      await prisma.gift.upsert({
        where: { roomId_orderId: { roomId: room.id, orderId: `seed_${room.id}_${g}` } },
        update: { receivedAt: at, dayKey: jstDateKey(at) },
        create: {
          roomId: room.id,
          uniqueId: listener,
          nickname: listener,
          giftId: 5655,
          giftName: "Rose",
          repeatCount: g + 1,
          diamondCount: 10,
          totalDiamonds: (g + 1) * 10 * (i + 1),
          receivedAt: at,
          dayKey: jstDateKey(at),
          orderId: `seed_${room.id}_${g}`,
        },
      });
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
