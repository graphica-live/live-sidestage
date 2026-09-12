/** Client-safe: 公開ページ見出しの期間ラベル。server-onlyの contribution-share.ts から分離。 */

export type ContributionShareRangeLabelInput = {
  period: string;
  dateRange: { start: string; end: string };
};

/** customのdateRangeはUTC ISOのため、AnalyticsViewと同様JSTで表示する。 */
export function formatContributionShareRangeLabel(payload: ContributionShareRangeLabelInput): string {
  if (payload.period === "custom") {
    const fmt = (iso: string) =>
      new Date(iso).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    return `${fmt(payload.dateRange.start)} 〜 ${fmt(payload.dateRange.end)}`;
  }
  const { start, end } = payload.dateRange;
  return start === end ? start : `${start} 〜 ${end}`;
}
