/** Client-safe: 公開ページが import してよい唯一の貢献シェアモジュール。
 * `contribution-share.ts` は prisma/sharp を引くのでクライアントから import しない。
 */

export type ContributionShareRangeLabelInput = {
  period: string;
  dateRange: { start: string; end: string };
};

/** 公開ページに載せる貢献者1人分。verifiedは含まない(所有者向け表示制御のため無意味)。 */
export type PublicContributionUser = {
  tiktokUid: string;
  tiktokHandle: string | null;
  nickname: string | null;
  profileImageUrl: string | null;
  giftCount: number;
  totalDiamonds: number;
  lastGiftAt: string;
};

export type PublicContributionPayload = {
  period: string;
  date: string | null;
  startDatetime: string | null;
  endDatetime: string | null;
  dateRange: { start: string; end: string };
  users: PublicContributionUser[];
  total: { giftCount: number; totalDiamonds: number };
  /** 誰の集計かを示すための配信者情報。tiktokHandle/tiktokUidは含めない。 */
  streamer: { nickname: string | null; profileImageUrl: string | null };
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
