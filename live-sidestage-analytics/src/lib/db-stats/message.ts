import type { DbStatsComparison } from "@/lib/db-stats/compare";
import type { ChartPoint } from "@/lib/db-stats/chart";
import { renderTrendChartPng } from "@/lib/db-stats/chart";
import type { AlertEmail, EmailInlineImage } from "@/lib/notify/email";

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

export type AnomalyTrend = { schemaName: string; tableName: string; points: ChartPoint[] };

/**
 * 件名・本文に加え、全体件数の推移グラフ + 異常テーブルごとの推移グラフを埋め込んだ
 * html本文を組み立てる。グラフが無い(履歴不足)場合はtextのみのメールにフォールバックする。
 */
export function buildDbStatsEmail(
  runDateJst: string,
  comparison: DbStatsComparison,
  totalTrend: ChartPoint[],
  anomalyTrends: AnomalyTrend[]
): AlertEmail {
  const { subject, text } = formatDbStatsMessage(runDateJst, comparison);

  if (totalTrend.length === 0 && anomalyTrends.length === 0) {
    return { subject, text };
  }

  const inlineImages: EmailInlineImage[] = [];
  const htmlSections: string[] = [];

  const totalChart = renderTrendChartPng("全テーブル合計件数の推移", totalTrend);
  inlineImages.push({ contentId: "total-trend", filename: "total-trend.png", content: totalChart });
  htmlSections.push(`<h3>全体件数の推移</h3><img src="cid:total-trend" alt="全体件数推移" width="640" height="220" />`);

  if (anomalyTrends.length > 0) {
    htmlSections.push("<h3>異常テーブルの推移</h3>");
    anomalyTrends.forEach((trend, i) => {
      const contentId = `anomaly-trend-${i}`;
      const chart = renderTrendChartPng(`${trend.schemaName}.${trend.tableName}`, trend.points);
      inlineImages.push({ contentId, filename: `${contentId}.png`, content: chart });
      htmlSections.push(
        `<p>${escapeHtml(trend.schemaName)}.${escapeHtml(trend.tableName)}</p>` +
          `<img src="cid:${contentId}" alt="${escapeHtml(trend.tableName)}の推移" width="640" height="220" />`
      );
    });
  }

  const html =
    `<pre style="font-family:monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>` + htmlSections.join("\n");

  return { subject, text, html, inlineImages };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
