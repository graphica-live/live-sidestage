import { prisma } from "@/lib/prisma";

export type TableAnomaly = {
  schemaName: string;
  tableName: string;
  prevCount: bigint;
  todayCount: bigint;
  pctChange: number | null; // prevCount=0からの増加は無限大なのでnull
};

/** 異常有無に関わらず全テーブル分持つ、前日比の件数。TableAnomalyと同形だが全件が対象。 */
export type TableStat = {
  schemaName: string;
  tableName: string;
  prevCount: bigint;
  todayCount: bigint;
  pctChange: number | null; // 前回記録が無い(prevCount=0)場合はnull
};

export type DbStatsComparison = {
  totalTables: number;
  totalRows: bigint;
  totalBytes: bigint;
  /** 前回記録が無ければnull(初回実行)。 */
  prevTotalRows: bigint | null;
  prevTotalBytes: bigint | null;
  totalRowsPctChange: number | null;
  totalBytesPctChange: number | null;
  /** 異常有無に関わらず全テーブル分の前日比。メール本文の全件一覧に使う。 */
  allTables: TableStat[];
  anomalies: TableAnomaly[];
};

const DEFAULT_THRESHOLD_PERCENT = 25;

function thresholdRatio(): number {
  const raw = Number(process.env.DB_STATS_ALERT_THRESHOLD_PERCENT ?? DEFAULT_THRESHOLD_PERCENT);
  return (Number.isFinite(raw) ? raw : DEFAULT_THRESHOLD_PERCENT) / 100;
}

function pctChangeOf(prev: bigint | null, today: bigint): number | null {
  if (prev === null || prev === 0n) return null; // ゼロ除算を避ける(新規データ扱い)
  return Number(today - prev) / Number(prev);
}

/** 当日分と直近の前回分を突き合わせ、全テーブルの前日比+閾値%超の増分テーブルを抽出する。 */
export async function compareToPrevious(runDate: Date): Promise<DbStatsComparison> {
  const today = await prisma.dbStatsSnapshot.findMany({
    where: { runDate },
    orderBy: [{ schemaName: "asc" }, { tableName: "asc" }],
  });

  const totalRows = today.reduce((sum, row) => sum + row.rowCount, 0n);
  const totalBytes = today.reduce((sum, row) => sum + row.totalBytes, 0n);

  const previousRun = await prisma.dbStatsSnapshot.findFirst({
    where: { runDate: { lt: runDate } },
    orderBy: { runDate: "desc" },
    select: { runDate: true },
  });

  if (!previousRun) {
    console.log("[db-stats] 前回の記録が無いため異常検知はスキップ(初回実行)");
    const allTables: TableStat[] = today.map((row) => ({
      schemaName: row.schemaName,
      tableName: row.tableName,
      prevCount: 0n,
      todayCount: row.rowCount,
      pctChange: null,
    }));
    return {
      totalTables: today.length,
      totalRows,
      totalBytes,
      prevTotalRows: null,
      prevTotalBytes: null,
      totalRowsPctChange: null,
      totalBytesPctChange: null,
      allTables,
      anomalies: [],
    };
  }

  const previous = await prisma.dbStatsSnapshot.findMany({ where: { runDate: previousRun.runDate } });
  const previousByKey = new Map(previous.map((row) => [`${row.schemaName}.${row.tableName}`, row]));
  const prevTotalRows = previous.reduce((sum, row) => sum + row.rowCount, 0n);
  const prevTotalBytes = previous.reduce((sum, row) => sum + row.totalBytes, 0n);

  const ratio = thresholdRatio();
  const anomalies: TableAnomaly[] = [];
  const allTables: TableStat[] = [];

  for (const row of today) {
    const prev = previousByKey.get(`${row.schemaName}.${row.tableName}`);
    const prevCount = prev?.rowCount ?? 0n;
    const pctChange = pctChangeOf(prevCount, row.rowCount);

    allTables.push({
      schemaName: row.schemaName,
      tableName: row.tableName,
      prevCount,
      todayCount: row.rowCount,
      pctChange,
    });

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

    if (pctChange !== null && pctChange >= ratio) {
      anomalies.push({
        schemaName: row.schemaName,
        tableName: row.tableName,
        prevCount,
        todayCount: row.rowCount,
        pctChange,
      });
    }
  }

  return {
    totalTables: today.length,
    totalRows,
    totalBytes,
    prevTotalRows,
    prevTotalBytes,
    totalRowsPctChange: pctChangeOf(prevTotalRows, totalRows),
    totalBytesPctChange: pctChangeOf(prevTotalBytes, totalBytes),
    allTables,
    anomalies,
  };
}
