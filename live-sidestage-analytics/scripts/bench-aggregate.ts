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
import { createBracket } from "../src/event/tournament";

const prisma = new PrismaClient();

const PARTICIPANTS = Number(process.env.BENCH_PARTICIPANTS ?? 20);
const LISTENERS = Number(process.env.BENCH_LISTENERS ?? 500);
const GIFTS = Number(process.env.BENCH_GIFTS ?? 100_000);
const PREFIX = "bench_agg";

// **now からの相対で組む。** バトル検知は現在時刻との前後関係で決まるので、固定日付だと
// トーナメントのシナリオが「まだ終わっていないバトル」になって新しい集計経路を通らない。
// 終了を未来に置くのは、締切(endAt + 猶予1時間)を過ぎて finalizedAt が立つと
// 2回目以降の計測が丸ごとスキップされるため。
const NOW = Date.now();
const START = new Date(NOW - 7 * 86_400_000);
const END = new Date(NOW + 86_400_000);
/** バトルはすべて過去に置く(検知 → 勝敗確定まで通す)。 */
const BATTLE_BASE = new Date(NOW - 3 * 86_400_000);

function assertLocal() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(`ローカルDB以外には実行しない: ${url.replace(/:[^:@]*@/, ":***@")}`);
  }
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM public.tiktok_battles WHERE "battleId" LIKE ${`${PREFIX}%`}`;
  await prisma.detectedBattle.deleteMany({ where: { battleId: { startsWith: PREFIX } } });
  await prisma.$executeRaw`DELETE FROM public."TiktokRoom" WHERE "tiktokId" LIKE ${`${PREFIX}%`}`;
  await prisma.event.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

/** 参加者(room)を作ってギフトを流し込む。format ごとに1イベント使う。 */
async function seedEvent(format: "DIAMOND_RACE" | "TOURNAMENT") {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${format}-${Date.now()}`,
      title: `集計ベンチ(${format})`,
      ownerUserId: `${PREFIX}_owner`,
      format,
      entryMode: "SOLO",
      status: "RUNNING",
      startAt: START,
      endAt: END,
      sessions: { create: [{ startAt: START, endAt: END }] },
    },
    select: { id: true },
  });

  const roomIds: string[] = [];
  const participantIds: string[] = [];
  for (let i = 0; i < PARTICIPANTS; i++) {
    const tiktokId = `${PREFIX}_${format.toLowerCase()}_liver_${i}`;
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO public."TiktokRoom" (id, "tiktokId", "createdAt")
      VALUES (gen_random_uuid()::text, ${tiktokId}, NOW())
      RETURNING id
    `;
    roomIds.push(rows[0].id);
    const p = await prisma.eventParticipant.create({
      data: { eventId: event.id, tiktokId, roomId: rows[0].id, displayName: tiktokId },
      select: { id: true },
    });
    participantIds.push(p.id);
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
    `[bench:${format}] ギフト ${inserted[0].count.toLocaleString()}件を投入 (${Date.now() - insertStarted}ms)`
  );

  return { eventId: event.id, roomIds, participantIds };
}

/**
 * トーナメント表を組み、1回戦ぶんのバトルを観測済みにする。
 *
 * **ここを通さないと BATTLE_ONLY の経路を一切測れない。** バトル区間が無いイベントは
 * クエリを1本も投げずに終わってしまい、「速い」という誤った結論になる。
 */
async function seedBattles(eventId: string, participantIds: string[]) {
  await createBracket({ eventId, entrantIds: participantIds });

  // **ペアはブラケットから読む。** シードの組み方(1位対最下位など)と不戦勝の入り方で
  // 実際の対戦相手は登録順にならないので、登録順で組むと1件も検知されない。
  const matches = await prisma.eventMatch.findMany({
    where: { eventId, round: 1 },
    orderBy: { bracketPosition: "asc" },
    select: {
      id: true,
      sides: {
        select: { participants: { select: { participant: { select: { roomId: true } } } } },
      },
    },
  });

  let seeded = 0;
  for (const match of matches) {
    const rooms = match.sides.map((s) => s.participants.map((p) => p.participant.roomId));
    // 両サイドに出場者がいる枠だけが検知の対象(不戦勝行は対象外)。
    if (rooms.length !== 2 || rooms.some((r) => r.length === 0)) continue;

    const battleId = `${PREFIX}_battle_${seeded}`;
    const startedAt = new Date(BATTLE_BASE.getTime() + seeded * 30 * 60_000);
    const endedAt = new Date(startedAt.getTime() + 10 * 60_000);
    for (const roomId of rooms.flat()) {
      await prisma.$executeRaw`
        INSERT INTO public.tiktok_battles
          (id, "roomId", "battleId", action, "startedAt", "startedAtEstimated", "endedAt",
           "durationSec", "hostUserIds", "hostDisplayIds", "hostScores", raw, "updatedAt")
        VALUES
          (gen_random_uuid()::text, ${roomId}, ${battleId}, 5, ${startedAt}, false, ${endedAt},
           600, ARRAY[]::text[], ARRAY[]::text[], '{}'::jsonb, '{}'::jsonb, NOW())
      `;
    }
    seeded++;
  }
  console.log(`[bench:TOURNAMENT] 1回戦のバトル ${seeded}件を観測済みにした`);
}

/** 同じイベントを3回集計して平均を出す。1回目は検知で余分に時間がかかるので別に出す。 */
async function measure(eventId: string, label: string) {
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const started = Date.now();
    const result = await aggregateEvent(eventId);
    runs.push(Date.now() - started);
    if (i === 0 && result.status === "done") {
      console.log(`${label}: 貢献 ${result.contributionRows}行 / 順位 ${result.standingRows}行`);
    }
  }
  const avg = Math.round(runs.reduce((a, b) => a + b, 0) / runs.length);
  console.log(`${label}: ${runs.join("ms, ")}ms (平均 ${avg}ms) — ${avg <= 10_000 ? "OK" : "SLO超過"}`);
}

async function main() {
  assertLocal();
  console.log(
    `[bench] 参加者 ${PARTICIPANTS}人 / リスナー ${LISTENERS}人 / ギフト ${GIFTS.toLocaleString()}件`
  );

  await cleanup();

  // --- 1. 獲得ダイヤレース(FULL_PERIOD): 日程まるごとを1本のクエリで引く従来の経路 ---
  const race = await seedEvent("DIAMOND_RACE");

  // EXPLAIN で索引が使われていることを確認する。
  const plan = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT "roomId", "uniqueId", SUM("totalDiamonds")::bigint AS diamonds, SUM("repeatCount")::int AS "giftCount"
    FROM public.gifts
    WHERE "roomId" = ANY(${race.roomIds}::text[]) AND "receivedAt" >= ${START} AND "receivedAt" < ${END}
    GROUP BY "roomId", "uniqueId"
  `;
  console.log("\n--- EXPLAIN (ANALYZE, BUFFERS) ---");
  for (const line of plan) console.log(line["QUERY PLAN"]);

  console.log("\n--- 集計: 獲得ダイヤレース (FULL_PERIOD) ---");
  await measure(race.eventId, "倍率なし(区間1本)");
  await prisma.eventMultiplier.create({
    data: {
      eventId: race.eventId,
      kind: "SOLO_STREAM",
      factor: "2",
      startAt: new Date(NOW - 4 * 86_400_000),
      endAt: new Date(NOW - 3 * 86_400_000),
    },
  });
  await measure(race.eventId, "倍率あり(区間3本)");

  // --- 2. トーナメント(BATTLE_ONLY): バトル区間ごとに引く新しい経路 ---
  const tournament = await seedEvent("TOURNAMENT");
  await seedBattles(tournament.eventId, tournament.participantIds);

  console.log("\n--- 集計: トーナメント (BATTLE_ONLY) ---");
  // 1周目は検知と勝敗確定が走るので別に測る(以降が定常の負荷)。
  await measure(tournament.eventId, "バトル区間のみ");
  await prisma.eventMultiplier.create({
    data: { eventId: tournament.eventId, kind: "BATTLE", factor: "2" },
  });
  await measure(tournament.eventId, "バトル区間のみ + BATTLE倍率");

  const segments = await prisma.eventMatch.count({
    where: { eventId: tournament.eventId, detectedStartAt: { not: null } },
  });
  console.log(`[bench:TOURNAMENT] 検知できた対戦 ${segments}件 = 集計クエリのおおよその本数`);

  await cleanup();
  console.log("\n[bench] ベンチ用データを片付けた");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
