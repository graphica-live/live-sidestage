import { prisma } from "@/lib/prisma";
import type { ChartPoint } from "@/lib/db-stats/chart";

const DEFAULT_HISTORY_RUNS = 14;

function formatDateLabel(runDate: Date): string {
  // DbStatsSnapshot.runDateはJST暦日を00:00Z相当で保持しているので、UTC表記のまま切り出してよい。
  return runDate.toISOString().slice(5, 10); // "MM-DD"
}

/** 直近N回分の「全テーブル合計件数」の推移。過去→現在の順で返す。 */
export async function fetchTotalRowsTrend(
  upToRunDate: Date,
  runs: number = DEFAULT_HISTORY_RUNS
): Promise<ChartPoint[]> {
  const runDates = await prisma.dbStatsSnapshot.findMany({
    where: { runDate: { lte: upToRunDate } },
    distinct: ["runDate"],
    select: { runDate: true },
    orderBy: { runDate: "desc" },
    take: runs,
  });

  const orderedDates = runDates.map((r) => r.runDate).reverse();
  if (orderedDates.length === 0) return [];

  const rows = await prisma.dbStatsSnapshot.groupBy({
    by: ["runDate"],
    where: { runDate: { in: orderedDates } },
    _sum: { rowCount: true },
  });
  const totalByDate = new Map(rows.map((r) => [r.runDate.getTime(), r._sum.rowCount ?? 0n]));

  return orderedDates.map((d) => ({
    label: formatDateLabel(d),
    value: Number(totalByDate.get(d.getTime()) ?? 0n),
  }));
}

/** 直近N回分の、指定テーブル1件の件数推移。過去→現在の順で返す。 */
export async function fetchTableRowsTrend(
  schemaName: string,
  tableName: string,
  upToRunDate: Date,
  runs: number = DEFAULT_HISTORY_RUNS
): Promise<ChartPoint[]> {
  const rows = await prisma.dbStatsSnapshot.findMany({
    where: { schemaName, tableName, runDate: { lte: upToRunDate } },
    select: { runDate: true, rowCount: true },
    orderBy: { runDate: "desc" },
    take: runs,
  });

  return rows
    .reverse()
    .map((r) => ({ label: formatDateLabel(r.runDate), value: Number(r.rowCount) }));
}
