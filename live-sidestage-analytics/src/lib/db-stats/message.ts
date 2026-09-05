import type { DbStatsComparison } from "@/lib/db-stats/compare";

export type DbStatsEmail = { subject: string; text: string };

/** メール通知の件名・本文を組み立てる。異常有無に関わらず毎日サマリを送る。 */
export function formatDbStatsMessage(runDateJst: string, comparison: DbStatsComparison): DbStatsEmail {
  const hasAnomaly = comparison.anomalies.length > 0;
  const subject = hasAnomaly
    ? `[DB統計] ${runDateJst} ⚠️異常増分${comparison.anomalies.length}件`
    : `[DB統計] ${runDateJst} 異常なし`;

  const lines = [
    `[DB統計] ${runDateJst}`,
    `全${comparison.totalTables}テーブル / 件数合計${comparison.totalRows.toString()} / サイズ合計${formatBytes(comparison.totalBytes)}`,
  ];

  if (!hasAnomaly) {
    lines.push("異常な増分はありません。");
  } else {
    lines.push(`⚠️ 前日比で急増したテーブル(${comparison.anomalies.length}件):`);
    for (const a of comparison.anomalies) {
      const pct = a.pctChange === null ? "新規データ" : `+${Math.round(a.pctChange * 100)}%`;
      lines.push(`  ${a.schemaName}.${a.tableName}: ${a.prevCount.toString()} → ${a.todayCount.toString()} (${pct})`);
    }
  }

  return { subject, text: lines.join("\n") };
}

function formatBytes(bytes: bigint): string {
  const mb = Number(bytes) / (1024 * 1024);
  return `${mb.toFixed(1)}MB`;
}
