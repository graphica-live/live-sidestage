import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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

  const rows = await prisma.$queryRaw<SummaryRow[]>`
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
