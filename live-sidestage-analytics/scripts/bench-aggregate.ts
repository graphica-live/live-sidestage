// 集計の性能を実測する。SLO(1イベント10秒以内)に収まっているかの確認用。
//
//   npm run bench:aggregate:local
//   BENCH_PARTICIPANTS=50 BENCH_LISTENERS=2000 BENCH_GIFTS=500000 npm run bench:aggregate:local
//
// ローカルの docker Postgres に対して実行すること(本番DBには絶対に流さない)。
// 実行後にベンチ用のデータは自分で片付ける。
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { aggregateEvent } from "../src/event/aggregate";

const prisma = new PrismaClient();

const PARTICIPANTS = Number(process.env.BENCH_PARTICIPANTS ?? 20);
const LISTENERS = Number(process.env.BENCH_LISTENERS ?? 500);
const GIFTS = Number(process.env.BENCH_GIFTS ?? 100_000);
const PREFIX = "bench_agg";

const START = new Date("2026-09-01T00:00:00.000Z");
const END = new Date("2026-09-08T00:00:00.000Z");

function assertLocal() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(`ローカルDB以外には実行しない: ${url.replace(/:[^:@]*@/, ":***@")}`);
  }
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM public."TiktokRoom" WHERE "tiktokId" LIKE ${`${PREFIX}%`}`;
  await prisma.event.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

async function main() {
  assertLocal();
  console.log(
    `[bench] 参加者 ${PARTICIPANTS}人 / リスナー ${LISTENERS}人 / ギフト ${GIFTS.toLocaleString()}件`
  );

  await cleanup();

  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${Date.now()}`,
      title: "集計ベンチ",
      ownerUserId: `${PREFIX}_owner`,
      format: "DIAMOND_RACE",
      entryMode: "SOLO",
      status: "RUNNING",
      startAt: START,
      endAt: END,
    },
    select: { id: true },
  });

  const roomIds: string[] = [];
  for (let i = 0; i < PARTICIPANTS; i++) {
    const tiktokId = `${PREFIX}_liver_${i}`;
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO public."TiktokRoom" (id, "tiktokId", "createdAt")
      VALUES (gen_random_uuid()::text, ${tiktokId}, NOW())
      RETURNING id
    `;
    roomIds.push(rows[0].id);
    await prisma.eventParticipant.create({
      data: {
        eventId: event.id,
        tiktokId,
        roomId: rows[0].id,
        displayName: tiktokId,
      },
    });
  }

  // ギフトは1件ずつ INSERT すると測定より投入の方が遅いので、SQL 側でまとめて生成する。
  const perRoom = Math.ceil(GIFTS / PARTICIPANTS);
  const insertStarted = Date.now();
  for (const roomId of roomIds) {
    await prisma.$executeRaw`
      INSERT INTO public.gifts
        (id, "roomId", "uniqueId", nickname, "giftId", "giftName", "repeatCount",
         "diamondCount", "totalDiamonds", "receivedAt", "dayKey", "orderId")
      SELECT gen_random_uuid()::text,
             ${roomId},
             'bench_listener_' || (g % ${LISTENERS}),
             'ベンチリスナー' || (g % ${LISTENERS}),
             5, 'Rose', 1, 10, 10,
             ${START} + (random() * (${END}::timestamp - ${START}::timestamp)),
             '2026-09-01',
             ${`${PREFIX}_`} || ${roomId} || '_' || g
      FROM generate_series(1, ${perRoom}) g
    `;
  }
  const inserted = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM public.gifts WHERE "roomId" = ANY(${roomIds}::text[])
  `;
  console.log(
    `[bench] ギフト ${inserted[0].count.toLocaleString()}件を投入 (${Date.now() - insertStarted}ms)`
  );

  // EXPLAIN で索引が使われていることを確認する。
  const plan = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT "roomId", "uniqueId", SUM("totalDiamonds")::bigint AS diamonds, SUM("repeatCount")::int AS "giftCount"
    FROM public.gifts
    WHERE "roomId" = ANY(${roomIds}::text[]) AND "receivedAt" >= ${START} AND "receivedAt" < ${END}
    GROUP BY "roomId", "uniqueId"
  `;
  console.log("\n--- EXPLAIN (ANALYZE, BUFFERS) ---");
  for (const line of plan) console.log(line["QUERY PLAN"]);

  // 倍率なし(区間1本)と倍率あり(区間3本)の両方を測る。
  console.log("\n--- 集計 ---");
  for (const label of ["倍率なし(区間1本)", "倍率あり(区間3本)"]) {
    if (label.startsWith("倍率あり")) {
      await prisma.eventMultiplier.create({
        data: {
          eventId: event.id,
          kind: "SOLO_STREAM",
          factor: "2",
          startAt: new Date("2026-09-03T00:00:00.000Z"),
          endAt: new Date("2026-09-04T00:00:00.000Z"),
        },
      });
    }

    const runs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const started = Date.now();
      const result = await aggregateEvent(event.id);
      const elapsed = Date.now() - started;
      runs.push(elapsed);
      if (i === 0 && result.status === "done") {
        console.log(
          `${label}: 貢献 ${result.contributionRows}行 / 順位 ${result.standingRows}行`
        );
      }
    }
    const avg = Math.round(runs.reduce((a, b) => a + b, 0) / runs.length);
    const slo = avg <= 10_000 ? "OK" : "SLO超過";
    console.log(`${label}: ${runs.join("ms, ")}ms (平均 ${avg}ms) — ${slo}`);
  }

  await cleanup();
  console.log("\n[bench] ベンチ用データを片付けた");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
