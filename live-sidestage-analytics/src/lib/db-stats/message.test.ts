import { describe, it, expect } from "vitest";
import { formatDbStatsMessage } from "@/lib/db-stats/message";
import type { DbStatsComparison } from "@/lib/db-stats/compare";

describe("formatDbStatsMessage", () => {
  it("異常なしのときは「異常な増分はありません」を出す", () => {
    const comparison: DbStatsComparison = {
      totalTables: 3,
      totalRows: 100n,
      totalBytes: 1024n * 1024n,
      anomalies: [],
    };

    const { subject, text } = formatDbStatsMessage("2026-09-06", comparison);

    expect(subject).toContain("異常なし");
    expect(text).toContain("異常な増分はありません");
    expect(text).toContain("全3テーブル");
    expect(text).not.toContain("⚠️");
  });

  it("異常テーブルがあれば件名・本文に件数と増加率を出す", () => {
    const comparison: DbStatsComparison = {
      totalTables: 2,
      totalRows: 500n,
      totalBytes: 2048n,
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
});
