// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { collectDbStats } from "@/lib/db-stats/collect";
import { compareToPrevious } from "@/lib/db-stats/compare";

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

  it("前回記録が無ければ異常なしで返す", async () => {
    await seed(DAY1, 100n);

    const result = await compareToPrevious(DAY1);

    expect(result.anomalies).toHaveLength(0);
  });

  it("前日比+25%未満は異常扱いしない", async () => {
    await seed(DAY2, 120n); // DAY1=100からは+20%

    const result = await compareToPrevious(DAY2);

    expect(result.anomalies.find((a) => a.tableName === FAKE_TABLE)).toBeUndefined();
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
