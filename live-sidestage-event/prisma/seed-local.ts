// ローカルテスト用のシードデータ。
// live-sidestage-analytics の docker compose (localhost:5433) を共用する前提。
//
//   cd live-sidestage-analytics && docker compose up -d db
//   cd ../live-sidestage-event && npm run db:push:local && npm run seed:local
//
// 本番DBに対しては絶対に実行しないこと(.env.local.test 以外の DATABASE_URL では止める)。

import { PrismaClient } from "@prisma/client";
import cuid from "cuid";

const prisma = new PrismaClient();

const SEED_OWNER_EMAIL = "dev@local.test";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("localhost") && !url.includes("127.0.0.1")) {
    throw new Error(`seed-local はローカルDB専用。DATABASE_URL が localhost ではない: ${url}`);
  }

  // 共有 User テーブルに開発用ユーザーを用意する(dev-login と同じ扱い)
  const existing = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM public."User" WHERE email = ${SEED_OWNER_EMAIL} LIMIT 1
  `;

  let ownerUserId: string;
  if (existing.length > 0) {
    ownerUserId = existing[0].id;
  } else {
    ownerUserId = cuid();
    await prisma.$executeRaw`
      INSERT INTO public."User" (id, name, email, "createdAt")
      VALUES (${ownerUserId}, 'dev', ${SEED_OWNER_EMAIL}, NOW())
    `;
  }

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
      startAt: new Date(now + 7 * 24 * 3600_000),
      endAt: new Date(now + 8 * 24 * 3600_000),
    },
  });

  await seedRaceEntries(race.id, race.startAt, race.endAt);

  console.log("seeded:", { ownerUserId, race: race.slug, draft: draft.slug });
  console.log("集計を流すには: npm run worker:local");
}

// 公開ページとランキングの確認用に、チーム・参加者・ギフトを入れる。
// ギフトは analytics 側の public.gifts に直接書く(ローカルDBなので admin 接続で書ける)。
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
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO public."TiktokRoom" (id, "tiktokId", "createdAt")
      VALUES (gen_random_uuid()::text, ${tiktokId}, NOW())
      ON CONFLICT ("tiktokId") DO UPDATE SET "tiktokId" = EXCLUDED."tiktokId"
      RETURNING id
    `;
    const roomId = rows[0].id;

    await prisma.eventParticipant.create({
      data: {
        eventId,
        tiktokId,
        roomId,
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
      await prisma.$executeRaw`
        INSERT INTO public.gifts
          (id, "roomId", "uniqueId", nickname, "giftId", "giftName", "repeatCount",
           "diamondCount", "totalDiamonds", "receivedAt", "dayKey", "orderId")
        VALUES
          (gen_random_uuid()::text, ${roomId}, ${listener}, ${listener}, 5, 'Rose',
           ${g + 1}, 10, ${(g + 1) * 10 * (i + 1)}, ${at}, '2026-08-21',
           ${`seed_${roomId}_${g}`})
        ON CONFLICT DO NOTHING
      `;
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
