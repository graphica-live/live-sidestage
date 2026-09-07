// 1バトルの participant ごとに「なぜ captureStatus がその値になったか」を出す**読み取り専用**の
// 診断スクリプト。DBへは一切書かない。
//
//   npx tsx scripts/diagnose-capture-status.ts <接続URLを書いたファイルのパス> <battleHistoryId>
//
// URL を引数に直書きせずファイル経由にしているのは、シェル履歴とプロセス一覧に本番の
// 認証情報を残さないため。
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { coverageFromIntervals, refineCaptureByScore } from "../src/lib/room-connection-log";

const urlFile = process.argv[2];
const battleHistoryId = process.argv[3];
if (!urlFile || !battleHistoryId) {
  throw new Error("usage: diagnose-capture-status.ts <url-file> <battleHistoryId>");
}
const url = readFileSync(urlFile, "utf8").replace(/^﻿/, "").trim();

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const battle = await prisma.battleHistory.findUniqueOrThrow({
    where: { id: battleHistoryId },
    select: {
      id: true,
      battleId: true,
      windowStart: true,
      windowEnd: true,
      participants: {
        select: {
          anchorId: true,
          roomId: true,
          captureStatus: true,
          captureCoverage: true,
          officialScore: true,
          nicknameSnapshot: true,
        },
      },
    },
  });

  const now = new Date();
  console.log(
    `battle=${battle.id} window=${battle.windowStart.toISOString()}..${battle.windowEnd.toISOString()}`
  );

  for (const p of battle.participants) {
    if (p.roomId === null) {
      console.log(`\nanchor=${p.anchorId} (${p.nicknameSnapshot}) roomId=null -> unavailable`);
      continue;
    }
    const intervals = await prisma.roomConnectionInterval.findMany({
      where: {
        roomId: p.roomId,
        startedAt: { lt: battle.windowEnd },
        OR: [{ endedAt: { gte: battle.windowStart } }, { endedAt: null }],
      },
      select: { startedAt: true, endedAt: true, lastHeartbeatAt: true },
      orderBy: { startedAt: "asc" },
    });
    const base = coverageFromIntervals(intervals, battle.windowStart, battle.windowEnd, now);
    const rows = await prisma.tiktokBattleArmiesSnapshot.findMany({
      where: { battleId: battle.battleId, anchorId: p.anchorId },
      select: { occurredAt: true, score: true },
      orderBy: { occurredAt: "asc" },
    });
    const finalScore = p.officialScore === null ? null : Number(p.officialScore);
    const refined = refineCaptureByScore(
      base,
      rows.map((r) => ({ atMs: r.occurredAt.getTime(), score: Number(r.score) })).filter((x) => Number.isFinite(x.score)),
      finalScore !== null && Number.isFinite(finalScore) ? finalScore : null
    );

    console.log(
      `\nanchor=${p.anchorId} (${p.nicknameSnapshot}) stored=${p.captureStatus}/${p.captureCoverage ?? "-"}`
    );
    console.log(`  intervals=${intervals.length} baseStatus=${base.status} baseCoverage=${base.coverage.toFixed(4)}`);
    for (const interval of intervals) {
      console.log(
        `    connected ${interval.startedAt.toISOString()} .. ${interval.endedAt?.toISOString() ?? `(open, hb=${interval.lastHeartbeatAt?.toISOString() ?? "-"})`}`
      );
    }
    for (const gap of base.gaps) {
      const startOffset = gap.startMs - battle.windowStart.getTime();
      const endOffset = gap.endMs - battle.windowStart.getTime();
      console.log(`    gap ${(startOffset / 1000).toFixed(1)}s .. ${(endOffset / 1000).toFixed(1)}s (${((gap.endMs - gap.startMs) / 1000).toFixed(1)}s)`);
    }
    console.log(
      `  refined=${refined.status} missedScore=${refined.missedScore ?? "-"} finalScore=${finalScore ?? "-"} armiesPoints=${rows.length}`
    );
  }
}

main()
  .catch((e) => {
    console.error("FAILED", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
