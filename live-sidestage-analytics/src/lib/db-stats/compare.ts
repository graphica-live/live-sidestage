import { prisma } from "@/lib/prisma";

export type TableAnomaly = {
  schemaName: string;
  tableName: string;
  prevCount: bigint;
  todayCount: bigint;
  pctChange: number | null; // prevCount=0からの増加は無限大なのでnull
};

export type DbStatsComparison = {
  totalTables: number;
  totalRows: bigint;
  totalBytes: bigint;
  anomalies: TableAnomaly[];
};

const DEFAULT_THRESHOLD_PERCENT = 25;

function thresholdRatio(): number {
  const raw = Number(process.env.DB_STATS_ALERT_THRESHOLD_PERCENT ?? DEFAULT_THRESHOLD_PERCENT);
  return (Number.isFinite(raw) ? raw : DEFAULT_THRESHOLD_PERCENT) / 100;
}

/** 当日分と直近の前回分を突き合わせ、前日比+閾値%超の増分テーブルを抽出する。 */
export async function compareToPrevious(runDate: Date): Promise<DbStatsComparison> {
  const today = await prisma.dbStatsSnapshot.findMany({ where: { runDate } });

  const totalRows = today.reduce((sum, row) => sum + row.rowCount, 0n);
  const totalBytes = today.reduce((sum, row) => sum + row.totalBytes, 0n);

  const previousRun = await prisma.dbStatsSnapshot.findFirst({
    where: { runDate: { lt: runDate } },
    orderBy: { runDate: "desc" },
    select: { runDate: true },
  });

  if (!previousRun) {
    console.log("[db-stats] 前回の記録が無いため異常検知はスキップ(初回実行)");
    return { totalTables: today.length, totalRows, totalBytes, anomalies: [] };
  }

  const previous = await prisma.dbStatsSnapshot.findMany({ where: { runDate: previousRun.runDate } });
  const previousByKey = new Map(previous.map((row) => [`${row.schemaName}.${row.tableName}`, row]));

  const ratio = thresholdRatio();
  const anomalies: TableAnomaly[] = [];

  for (const row of today) {
    const prev = previousByKey.get(`${row.schemaName}.${row.tableName}`);
    const prevCount = prev?.rowCount ?? 0n;
    if (prevCount === 0n) {
      if (row.rowCount > 0n) {
        anomalies.push({
          schemaName: row.schemaName,
          tableName: row.tableName,
          prevCount,
          todayCount: row.rowCount,
          pctChange: null,
        });
      }
      continue;
    }

    const pctChange = Number(row.rowCount - prevCount) / Number(prevCount);
    if (pctChange >= ratio) {
      anomalies.push({
        schemaName: row.schemaName,
        tableName: row.tableName,
        prevCount,
        todayCount: row.rowCount,
        pctChange,
      });
    }
  }

  return { totalTables: today.length, totalRows, totalBytes, anomalies };
}
