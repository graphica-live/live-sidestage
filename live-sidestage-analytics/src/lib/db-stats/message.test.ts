import { describe, it, expect } from "vitest";
import { formatDbStatsMessage, buildDbStatsEmail } from "@/lib/db-stats/message";
import type { DbStatsComparison } from "@/lib/db-stats/compare";
import type { ChartPoint } from "@/lib/db-stats/chart";

describe("formatDbStatsMessage", () => {
  it("異常なしのときは「異常な増分はありません」を出す", () => {
    const comparison: DbStatsComparison = {
      totalTables: 3,
      totalRows: 100n,
      totalBytes: 1024n * 1024n,
      prevTotalRows: 90n,
      prevTotalBytes: 900n * 1024n,
      totalRowsPctChange: 100 / 90 - 1,
      totalBytesPctChange: (1024 - 900) / 900,
      allTables: [
        { schemaName: "public", tableName: "a", prevCount: 30n, todayCount: 33n, pctChange: 0.1 },
        { schemaName: "public", tableName: "b", prevCount: 30n, todayCount: 33n, pctChange: 0.1 },
        { schemaName: "public", tableName: "c", prevCount: 30n, todayCount: 34n, pctChange: 0.133 },
      ],
      anomalies: [],
    };

    const { subject, text } = formatDbStatsMessage("2026-09-06", comparison);

    expect(subject).toContain("異常なし");
    expect(text).toContain("異常な増分はありません");
    expect(text).toContain("全3テーブル");
    expect(text).not.toContain("⚠️");
    expect(text).toContain("件数合計: 90 → 100 (+11%)");
    expect(text).toContain("public.a: 30 → 33 (+10%)");
    expect(text).toContain("public.c: 30 → 34 (+13%)");
  });

  it("異常テーブルがあれば件名・本文に件数と増加率を出す", () => {
    const comparison: DbStatsComparison = {
      totalTables: 2,
      totalRows: 500n,
      totalBytes: 2048n,
      prevTotalRows: 400n,
      prevTotalBytes: 2048n,
      totalRowsPctChange: 0.25,
      totalBytesPctChange: 0,
      allTables: [
        { schemaName: "public", tableName: "gifts", prevCount: 100n, todayCount: 126n, pctChange: 0.26 },
      ],
      anomalies: [
        {
          schemaName: "public",
          tableName: "gifts",
          prevCount: 100n,
          todayCount: 126n,
          pctChange: 0.26,
        },
      ],
    };

    const { subject, text } = formatDbStatsMessage("2026-09-06", comparison);

    expect(subject).toContain("異常増分1件");
    expect(text).toContain("⚠️");
    expect(text).toContain("public.gifts: 100 → 126 (+26%)");
  });

  it("prevCount=0からの増加は「新規データ」と表示する", () => {
    const comparison: DbStatsComparison = {
      totalTables: 1,
      totalRows: 5n,
      totalBytes: 100n,
      prevTotalRows: 0n,
      prevTotalBytes: 0n,
      totalRowsPctChange: null,
      totalBytesPctChange: null,
      allTables: [{ schemaName: "event", tableName: "NewTable", prevCount: 0n, todayCount: 5n, pctChange: null }],
      anomalies: [
        {
          schemaName: "event",
          tableName: "NewTable",
          prevCount: 0n,
          todayCount: 5n,
          pctChange: null,
        },
      ],
    };

    const { text } = formatDbStatsMessage("2026-09-06", comparison);

    expect(text).toContain("event.NewTable: 0 → 5 (新規データ)");
  });

  it("前回記録が無い(初回実行)ときは全体合計を「初回記録」と表示する", () => {
    const comparison: DbStatsComparison = {
      totalTables: 1,
      totalRows: 5n,
      totalBytes: 1024n * 1024n,
      prevTotalRows: null,
      prevTotalBytes: null,
      totalRowsPctChange: null,
      totalBytesPctChange: null,
      allTables: [{ schemaName: "public", tableName: "a", prevCount: 0n, todayCount: 5n, pctChange: null }],
      anomalies: [],
    };

    const { text } = formatDbStatsMessage("2026-09-06", comparison);

    expect(text).toContain("件数合計: 5(初回記録、前日比較なし)");
    expect(text).toContain("サイズ合計: 1.0MB(初回記録、前日比較なし)");
  });

  it("全テーブル一覧は件数が減少したテーブルも符号付きで含む", () => {
    const comparison: DbStatsComparison = {
      totalTables: 1,
      totalRows: 80n,
      totalBytes: 100n,
      prevTotalRows: 100n,
      prevTotalBytes: 100n,
      totalRowsPctChange: -0.2,
      totalBytesPctChange: 0,
      allTables: [{ schemaName: "public", tableName: "shrinking", prevCount: 100n, todayCount: 80n, pctChange: -0.2 }],
      anomalies: [],
    };

    const { text } = formatDbStatsMessage("2026-09-06", comparison);

    expect(text).toContain("public.shrinking: 100 → 80 (-20%)");
    expect(text).toContain("件数合計: 100 → 80 (-20%)");
  });
});

describe("buildDbStatsEmail", () => {
  const comparison: DbStatsComparison = {
    totalTables: 2,
    totalRows: 500n,
    totalBytes: 2048n,
    prevTotalRows: 400n,
    prevTotalBytes: 2048n,
    totalRowsPctChange: 0.25,
    totalBytesPctChange: 0,
    allTables: [
      { schemaName: "public", tableName: "gifts", prevCount: 100n, todayCount: 126n, pctChange: 0.26 },
    ],
    anomalies: [
      { schemaName: "public", tableName: "gifts", prevCount: 100n, todayCount: 126n, pctChange: 0.26 },
    ],
  };
  const totalTrend: ChartPoint[] = [
    { label: "09-04", value: 400 },
    { label: "09-05", value: 450 },
    { label: "09-06", value: 500 },
  ];

  it("全体トレンドも異常テーブルトレンドも無ければtextのみのメールにフォールバックする", () => {
    const email = buildDbStatsEmail("2026-09-06", comparison, [], []);

    expect(email.html).toBeUndefined();
    expect(email.inlineImages).toBeUndefined();
    expect(email.text).toContain("public.gifts");
  });

  it("全体トレンドが空でも異常テーブルトレンドがあればhtmlメールを組み立てる", () => {
    const anomalyTrends = [{ schemaName: "public", tableName: "gifts", points: totalTrend }];

    const email = buildDbStatsEmail("2026-09-06", comparison, [], anomalyTrends);

    expect(email.html).toBeDefined();
    expect(email.inlineImages).toHaveLength(2); // 全体(データなしプレースホルダ) + 異常テーブル1件
    expect(email.html).toContain("cid:anomaly-trend-0");
  });

  it("全体トレンドの埋め込み画像とcid参照を持つhtmlを組み立てる", () => {
    const email = buildDbStatsEmail("2026-09-06", comparison, totalTrend, []);

    expect(email.inlineImages).toHaveLength(1);
    expect(email.inlineImages?.[0].contentId).toBe("total-trend");
    expect(email.inlineImages?.[0].content.length).toBeGreaterThan(0);
    expect(email.html).toContain('cid:total-trend');
  });

  it("異常テーブルごとのトレンド画像も追加する", () => {
    const anomalyTrends = [
      { schemaName: "public", tableName: "gifts", points: totalTrend },
    ];

    const email = buildDbStatsEmail("2026-09-06", comparison, totalTrend, anomalyTrends);

    expect(email.inlineImages).toHaveLength(2);
    expect(email.inlineImages?.[1].contentId).toBe("anomaly-trend-0");
    expect(email.html).toContain("cid:anomaly-trend-0");
    expect(email.html).toContain("public.gifts");
  });

  it("htmlのpre本文にも全テーブル一覧・全体合計欄が含まれる", () => {
    const email = buildDbStatsEmail("2026-09-06", comparison, totalTrend, []);

    expect(email.html).toContain("件数合計: 400 → 500 (+25%)");
    expect(email.html).toContain("public.gifts: 100 → 126 (+26%)");
  });
});
