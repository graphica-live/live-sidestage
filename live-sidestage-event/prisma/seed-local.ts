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

  console.log("seeded:", { ownerUserId, race: race.slug, draft: draft.slug });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
