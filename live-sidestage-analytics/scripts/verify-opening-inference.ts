// 本番の確定済みバトルに対して inferOpeningMultiplier を再実行し、confidence の分布を出す
// **読み取り専用**の検証スクリプト。DBへは一切書かない。
//
//   npx tsx scripts/verify-opening-inference.ts <接続URLを書いたファイルのパス> [battleHistoryId]
//
// URL を引数に直書きせずファイル経由にしているのは、シェル履歴とプロセス一覧に本番の
// 認証情報を残さないため。
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { inferOpeningMultiplier } from "../src/lib/battle-opening-multiplier";

const urlFile = process.argv[2];
const only = process.argv[3] ?? null;
if (!urlFile) throw new Error("usage: verify-opening-inference.ts <url-file> [battleHistoryId]");
const url = readFileSync(urlFile, "utf8").replace(/^﻿/, "").trim();

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const battles = await prisma.battleHistory.findMany({
    where: only ? { id: only } : { replayScorePointCount: { gte: 2 } },
    orderBy: { windowStart: "desc" },
    take: only ? 1 : 200,
    select: {
      id: true,
      roomId: true,
      battleId: true,
      windowStart: true,
      openingMultiplier: true,
      openingMultiplierConfidence: true,
      scorePoints: { select: { anchorId: true, occurredAt: true, score: true } },
      participants: {
        select: {
          anchorId: true,
          captureStatus: true,
          giftEvents: {
            select: {
              sourceGiftId: true,
              occurredAt: true,
              totalDiamonds: true,
              multiplierType: true,
            },
          },
        },
      },
      bonusMissions: { select: { rewardStartedAt: true, rewardEndedAt: true } },
    },
  });

  const tally = new Map<string, number>();
  for (const battle of battles) {
    const source = await prisma.tiktokBattle.findUnique({
      where: { roomId_battleId: { roomId: battle.roomId, battleId: battle.battleId } },
      select: { startedAtEstimated: true },
    });

    // src/lib/battle-tap-points.ts の loadTapPointsForBattle と同じ読み方。
    // (あちらは `@/lib/prisma` のシングルトンを使うので、本番URL指定のこのクライアントからは呼べない)
    const tapRows = await prisma.tiktokBattleTapPoint.findMany({
      where: { battleId: battle.battleId },
      select: { roomId: true, anchorId: true, occurredAt: true, points: true },
      orderBy: [{ occurredAt: "asc" }, { anchorId: "asc" }],
    });
    const trackedRoomIds = new Set(
      (
        await prisma.tiktokBattle.findMany({
          where: { battleId: battle.battleId },
          select: { roomId: true, tapPointsTracked: true },
        })
      )
        .filter((b) => b.tapPointsTracked)
        .map((b) => b.roomId)
    );
    const tapInput = {
      tapPoints: tapRows.map((r) => ({ anchorId: r.anchorId, occurredAt: r.occurredAt, points: r.points })),
      tapTrackedAnchorIds: new Set(tapRows.filter((r) => trackedRoomIds.has(r.roomId)).map((r) => r.anchorId)),
    };

    const result = inferOpeningMultiplier({
      windowStart: battle.windowStart,
      windowStartReliable: source !== null && !source.startedAtEstimated,
      scorePoints: battle.scorePoints,
      gifts: battle.participants.flatMap((p) =>
        // 部分欠落した anchor は比が過大に出て偽の measured を作るので、確定処理と同じ基準で外す。
        p.captureStatus !== "complete"
          ? []
          : p.giftEvents.map((g) => ({
              id: g.sourceGiftId,
              anchorId: p.anchorId,
              occurredAt: g.occurredAt,
              totalDiamonds: g.totalDiamonds,
              multiplierType: g.multiplierType,
            }))
      ),
      bonusIntervals: battle.bonusMissions.map((m) => ({
        startedAt: m.rewardStartedAt,
        endedAt: m.rewardEndedAt,
      })),
      ...tapInput,
    });

    if (only) {
      for (const p of battle.participants) {
        console.log(
          `  anchor=${p.anchorId} capture=${p.captureStatus} gifts=${p.giftEvents.length} diamonds=${p.giftEvents.reduce((s, g) => s + g.totalDiamonds, 0)}`
        );
      }
    }

    const key = `${result.confidence}/${result.multiplier ?? "-"}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    if (only || result.confidence !== "unknown") {
      console.log(
        `${battle.id} ${battle.windowStart.toISOString()} stored=${battle.openingMultiplierConfidence}/${battle.openingMultiplier ?? "-"} -> ${key}`
      );
    }
  }

  console.log("\ntally:", JSON.stringify([...tally.entries()].sort((a, b) => b[1] - a[1])));
  console.log("battles examined:", battles.length);
}

main()
  .catch((e) => {
    console.error("FAILED", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
