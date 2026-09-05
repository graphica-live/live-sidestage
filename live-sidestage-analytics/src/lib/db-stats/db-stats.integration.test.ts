// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { collectDbStats } from "@/lib/db-stats/collect";
import { compareToPrevious } from "@/lib/db-stats/compare";
import { fetchTotalRowsTrend, fetchTableRowsTrend } from "@/lib/db-stats/history";

// 実テーブルと衝突しない架空のschema/tableName、かつ他テストのrunDateとも重ならない過去日付を使う。
const FAKE_SCHEMA = "public";
const FAKE_TABLE = "itest_db_stats_fake_table";
const DAY1 = new Date("2020-01-01T00:00:00.000Z");
const DAY2 = new Date("2020-01-02T00:00:00.000Z");
const DAY3 = new Date("2020-01-03T00:00:00.000Z");

async function seed(runDate: Date, rowCount: bigint) {
  await prisma.dbStatsSnapshot.upsert({
    where: { runDate_schemaName_tableName: { runDate, schemaName: FAKE_SCHEMA, tableName: FAKE_TABLE } },
    create: { runDate, schemaName: FAKE_SCHEMA, tableName: FAKE_TABLE, rowCount, totalBytes: 1024n },
    update: { rowCount },
  });
}

describe("compareToPrevious", () => {
  afterAll(async () => {
    await prisma.dbStatsSnapshot.deleteMany({ where: { tableName: FAKE_TABLE } });
  });

  it("前回記録が無ければ異常なしで返す。allTablesは前回0件・全体合計はnullで返る", async () => {
    await seed(DAY1, 100n);

    const result = await compareToPrevious(DAY1);

    expect(result.anomalies).toHaveLength(0);
    expect(result.prevTotalRows).toBeNull();
    expect(result.prevTotalBytes).toBeNull();
    expect(result.totalRowsPctChange).toBeNull();
    const stat = result.allTables.find((t) => t.tableName === FAKE_TABLE);
    expect(stat).toBeDefined();
    expect(stat?.prevCount).toBe(0n);
    expect(stat?.todayCount).toBe(100n);
    expect(stat?.pctChange).toBeNull();
  });

  it("前日比+25%未満は異常扱いしない。allTablesには非異常テーブルも含まれる", async () => {
    await seed(DAY2, 120n); // DAY1=100からは+20%

    const result = await compareToPrevious(DAY2);

    expect(result.anomalies.find((a) => a.tableName === FAKE_TABLE)).toBeUndefined();
    const stat = result.allTables.find((t) => t.tableName === FAKE_TABLE);
    expect(stat).toBeDefined();
    expect(stat?.prevCount).toBe(100n);
    expect(stat?.todayCount).toBe(120n);
    expect(stat?.pctChange).toBeCloseTo(0.2, 2);
    expect(result.prevTotalRows).not.toBeNull();
  });

  it("前日比+25%以上は異常として検出する", async () => {
    await seed(DAY3, 151n); // DAY2=120からは+25.8%

    const result = await compareToPrevious(DAY3);

    const anomaly = result.anomalies.find((a) => a.tableName === FAKE_TABLE);
    expect(anomaly).toBeDefined();
    expect(anomaly?.prevCount).toBe(120n);
    expect(anomaly?.todayCount).toBe(151n);
    expect(anomaly?.pctChange).toBeCloseTo(0.258, 2);
  });

  it("前回0件から増加した場合はpctChange=nullで異常検出する", async () => {
    const zeroDay = new Date("2020-01-10T00:00:00.000Z");
    const nextDay = new Date("2020-01-11T00:00:00.000Z");
    await seed(zeroDay, 0n);
    await seed(nextDay, 3n);

    const result = await compareToPrevious(nextDay);

    const anomaly = result.anomalies.find((a) => a.tableName === FAKE_TABLE);
    expect(anomaly).toBeDefined();
    expect(anomaly?.pctChange).toBeNull();

    await prisma.dbStatsSnapshot.deleteMany({ where: { runDate: { in: [zeroDay, nextDay] } } });
  });

  it("全体合計(件数・サイズ)の前日比を計算する", async () => {
    const prevDay = new Date("2020-01-20T00:00:00.000Z");
    const todayDay = new Date("2020-01-21T00:00:00.000Z");
    const table2 = `${FAKE_TABLE}_2`;

    await prisma.dbStatsSnapshot.upsert({
      where: { runDate_schemaName_tableName: { runDate: prevDay, schemaName: FAKE_SCHEMA, tableName: FAKE_TABLE } },
      create: { runDate: prevDay, schemaName: FAKE_SCHEMA, tableName: FAKE_TABLE, rowCount: 100n, totalBytes: 1000n },
      update: { rowCount: 100n, totalBytes: 1000n },
    });
    await prisma.dbStatsSnapshot.upsert({
      where: { runDate_schemaName_tableName: { runDate: prevDay, schemaName: FAKE_SCHEMA, tableName: table2 } },
      create: { runDate: prevDay, schemaName: FAKE_SCHEMA, tableName: table2, rowCount: 50n, totalBytes: 500n },
      update: { rowCount: 50n, totalBytes: 500n },
    });
    await prisma.dbStatsSnapshot.upsert({
      where: { runDate_schemaName_tableName: { runDate: todayDay, schemaName: FAKE_SCHEMA, tableName: FAKE_TABLE } },
      create: { runDate: todayDay, schemaName: FAKE_SCHEMA, tableName: FAKE_TABLE, rowCount: 120n, totalBytes: 1200n },
      update: { rowCount: 120n, totalBytes: 1200n },
    });
    await prisma.dbStatsSnapshot.upsert({
      where: { runDate_schemaName_tableName: { runDate: todayDay, schemaName: FAKE_SCHEMA, tableName: table2 } },
      create: { runDate: todayDay, schemaName: FAKE_SCHEMA, tableName: table2, rowCount: 60n, totalBytes: 600n },
      update: { rowCount: 60n, totalBytes: 600n },
    });

    const result = await compareToPrevious(todayDay);

    expect(result.totalRows).toBe(180n); // 120+60
    expect(result.prevTotalRows).toBe(150n); // 100+50
    expect(result.totalRowsPctChange).toBeCloseTo(0.2, 5);
    expect(result.totalBytes).toBe(1800n);
    expect(result.prevTotalBytes).toBe(1500n);
    expect(result.totalBytesPctChange).toBeCloseTo(0.2, 5);

    await prisma.dbStatsSnapshot.deleteMany({ where: { runDate: { in: [prevDay, todayDay] } } });
    await prisma.dbStatsSnapshot.deleteMany({ where: { tableName: table2 } });
  });
});

describe("collectDbStats", () => {
  const runDate = new Date("2020-02-01T00:00:00.000Z");

  afterAll(async () => {
    await prisma.dbStatsSnapshot.deleteMany({ where: { runDate } });
  });

  // rowCountの厳密な期待値を他テーブルの実件数と突き合わせない。他の統合テストファイルが
  // 同一ワーカープロセスで並行してUser等を書き換えるため、時点をまたぐ厳密一致は
  // レース条件でflakyになる(analytics-vitest-cross-file-interferenceと同型の共有資源問題)。
  // ここではテーブルが実在し、非負の値が記録されることだけを確認する。
  it("実テーブルの件数・サイズを記録する", async () => {
    const { tables } = await collectDbStats(runDate);
    expect(tables).toBeGreaterThan(0);

    const userSnapshot = await prisma.dbStatsSnapshot.findUnique({
      where: { runDate_schemaName_tableName: { runDate, schemaName: "public", tableName: "User" } },
    });

    expect(userSnapshot).not.toBeNull();
    expect(userSnapshot?.rowCount).toBeGreaterThanOrEqual(0n);
    expect(userSnapshot?.totalBytes).toBeGreaterThanOrEqual(0n);

    const selfSnapshot = await prisma.dbStatsSnapshot.findFirst({
      where: { runDate, tableName: "DbStatsSnapshot" },
    });
    expect(selfSnapshot).toBeNull();
  });
});

describe("history", () => {
  const HIST_TABLE = "itest_db_stats_history_fake_table";
  const HD1 = new Date("2020-03-01T00:00:00.000Z");
  const HD2 = new Date("2020-03-02T00:00:00.000Z");
  const HD3 = new Date("2020-03-03T00:00:00.000Z");

  afterAll(async () => {
    await prisma.dbStatsSnapshot.deleteMany({ where: { tableName: HIST_TABLE } });
  });

  it("fetchTableRowsTrendは過去→現在の順で指定テーブルの件数推移を返す", async () => {
    await prisma.dbStatsSnapshot.upsert({
      where: {
        runDate_schemaName_tableName: { runDate: HD1, schemaName: FAKE_SCHEMA, tableName: HIST_TABLE },
      },
      create: { runDate: HD1, schemaName: FAKE_SCHEMA, tableName: HIST_TABLE, rowCount: 10n, totalBytes: 1n },
      update: { rowCount: 10n },
    });
    await prisma.dbStatsSnapshot.upsert({
      where: {
        runDate_schemaName_tableName: { runDate: HD2, schemaName: FAKE_SCHEMA, tableName: HIST_TABLE },
      },
      create: { runDate: HD2, schemaName: FAKE_SCHEMA, tableName: HIST_TABLE, rowCount: 20n, totalBytes: 1n },
      update: { rowCount: 20n },
    });
    await prisma.dbStatsSnapshot.upsert({
      where: {
        runDate_schemaName_tableName: { runDate: HD3, schemaName: FAKE_SCHEMA, tableName: HIST_TABLE },
      },
      create: { runDate: HD3, schemaName: FAKE_SCHEMA, tableName: HIST_TABLE, rowCount: 30n, totalBytes: 1n },
      update: { rowCount: 30n },
    });

    const trend = await fetchTableRowsTrend(FAKE_SCHEMA, HIST_TABLE, HD3, 3);

    expect(trend.map((p) => p.value)).toEqual([10, 20, 30]);
    expect(trend[0].label).toBe("03-01");
    expect(trend[2].label).toBe("03-03");
  });

  it("fetchTotalRowsTrendは実行日ごとの全テーブル合計件数を返す", async () => {
    const trend = await fetchTotalRowsTrend(HD3, 3);

    const hd3Point = trend.find((p) => p.label === "03-03");
    expect(hd3Point).toBeDefined();
    expect(hd3Point!.value).toBeGreaterThanOrEqual(30);
  });
});
