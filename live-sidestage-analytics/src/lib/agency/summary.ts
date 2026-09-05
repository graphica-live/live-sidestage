import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  isWithinRawGiftWindow,
  resolveRollupReadCutoff,
  shiftDayKey,
} from "@/lib/gift-retention-window";

// 事務所APIはオリジナル生データ基準(src/lib/gift-analytics.ts の queryGifts とは
// 集計単位が違う)。APIレスポンスでは basis: "raw" としてその契約を明示する。
export type RoomSummary = {
  roomId: string;
  giftCount: number;
  totalDiamonds: number;
  supporterCount: number;
  lastGiftAt: string | null;
};

export function emptySummary(roomId: string): RoomSummary {
  return { roomId, giftCount: 0, totalDiamonds: 0, supporterCount: 0, lastGiftAt: null };
}

type SummaryRow = {
  roomId: string;
  giftCount: bigint | number | null;
  totalDiamonds: bigint | number | null;
  supporterCount: bigint | number;
  lastGiftAt: Date | null;
};

function toNumber(value: bigint | number | null): number {
  if (value === null) return 0;
  return typeof value === "bigint" ? Number(value) : value;
}

/**
 * 明細(gifts)だけを読む従来のクエリ。**範囲がロールアップ境界より新しいときはこのまま。**
 */
function queryRawOnly(roomIds: string[], range: { from: string; to: string }) {
  return prisma.$queryRaw<SummaryRow[]>`
    SELECT
      "roomId"                          AS "roomId",
      SUM("repeatCount")                AS "giftCount",
      SUM("totalDiamonds")              AS "totalDiamonds",
      COUNT(DISTINCT "uniqueId")        AS "supporterCount",
      MAX("receivedAt")                 AS "lastGiftAt"
    FROM "gifts"
    WHERE "roomId" IN (${Prisma.join(roomIds)})
      AND "dayKey" >= ${range.from}
      AND "dayKey" <= ${range.to}
    GROUP BY "roomId"
  `;
}

/**
 * カットオフより古い部分を日次ロールアップから読み、UNION ALL してから集計する。
 *
 * **supporterCount(COUNT DISTINCT)は2つのクエリの結果を足し合わせられない**
 * (同じリスナーが両方の期間にいると二重に数える)ため、SQLの中で1つの集合へ寄せる。
 */
function queryWithRollup(
  roomIds: string[],
  range: { from: string; to: string },
  cutoffDayKey: string
) {
  const rawFrom = range.from > cutoffDayKey ? range.from : cutoffDayKey;
  const rollupTo = shiftDayKey(cutoffDayKey, -1);
  return prisma.$queryRaw<SummaryRow[]>`
    WITH src AS (
      SELECT "roomId", "repeatCount" AS gc, "totalDiamonds"::bigint AS td, "uniqueId", "receivedAt" AS ts
        FROM "gifts"
       WHERE "roomId" IN (${Prisma.join(roomIds)})
         AND "dayKey" >= ${rawFrom}
         AND "dayKey" <= ${range.to}
      UNION ALL
      SELECT "roomId", "giftCount" AS gc, "totalDiamonds"::bigint AS td, "uniqueId", "lastReceivedAt" AS ts
        FROM "gift_daily_listener_stats"
       WHERE "roomId" IN (${Prisma.join(roomIds)})
         AND "dayKey" >= ${range.from}
         AND "dayKey" <= ${range.to < rollupTo ? range.to : rollupTo}
    )
    SELECT
      "roomId"                   AS "roomId",
      SUM(gc)                    AS "giftCount",
      SUM(td)                    AS "totalDiamonds",
      COUNT(DISTINCT "uniqueId") AS "supporterCount",
      MAX(ts)                    AS "lastGiftAt"
    FROM src
    GROUP BY "roomId"
  `;
}

async function queryRows(
  roomIds: string[],
  range: { from: string; to: string }
): Promise<SummaryRow[]> {
  if (isWithinRawGiftWindow(range.from)) return queryRawOnly(roomIds, range);

  const cutoffDayKey = await resolveRollupReadCutoff();
  if (range.from >= cutoffDayKey) return queryRawOnly(roomIds, range);

  return queryWithRollup(roomIds, range, cutoffDayKey);
}

// 複数のTiktokRoomをまたいだ期間集計を、部屋ごとに1行で返す。
// 期間は dayKey で絞ることで @@index([roomId, dayKey]) に乗せる。
//
// COUNT(DISTINCT "uniqueId") はSQLで完結させる。PrismaのgroupByには distinct count が無く、
// (roomId, uniqueId) でgroupByすると支援者の全組み合わせをNodeへ転送して数えることになり、
// 長期間×多room指定で転送量が跳ねるため。
export async function queryRoomSummariesRaw(
  roomIds: string[],
  range: { from: string; to: string }
): Promise<Map<string, RoomSummary>> {
  const result = new Map<string, RoomSummary>();
  if (roomIds.length === 0) return result;

  for (const roomId of roomIds) {
    result.set(roomId, emptySummary(roomId));
  }

  const rows = await queryRows(roomIds, range);

  for (const row of rows) {
    result.set(row.roomId, {
      roomId: row.roomId,
      giftCount: toNumber(row.giftCount),
      totalDiamonds: toNumber(row.totalDiamonds),
      supporterCount: toNumber(row.supporterCount),
      lastGiftAt: row.lastGiftAt?.toISOString() ?? null,
    });
  }

  return result;
}
