import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { queryContributionRankingByShareToken } from "@/lib/contribution-share";
import { PublicContributionClient } from "./PublicContributionClient";

// 貢献ランキング(期間集計)シェアリンクの公開ページ。**トークンが「どの配信者・どの期間か」を
// 決める**(バトル再生ページの `/b/[token]` と同じ設計)。
//
// 認証は無い(URLを知っている人は誰でも見られる)。middleware の除外へ `c(?:/|$)` を
// 入れてあり、**境界を外すと想定しないパスまで公開される**(src/middleware.test.ts が固定)。
//
// ペイロードは `queryContributionRankingByShareToken` が返す公開専用の型(verifiedのみ除外)。
// ここでサーバー側が1回だけ読み、クライアントへ渡す。ギフト内訳アコーディオンは
// `/api/public/contribution/[token]/breakdown` をクライアント側から叩く(所有者向け
// `/gifts/breakdown` の公開トークン版)。
export const dynamic = "force-dynamic";

/** `generateMetadata` と本体で二重にDBを引かないための同一リクエスト内キャッシュ。 */
const loadContribution = cache(async (token: string) => queryContributionRankingByShareToken(token));

function periodLabelOf(period: string): string {
  if (period === "day") return "日別";
  if (period === "week") return "週別";
  if (period === "month") return "月別";
  if (period === "year") return "年別";
  return "期間指定";
}

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const result = await loadContribution(params.token);
  // **トークンの存否を出し分けない。** 見つからない場合は一律この表示にする。
  if (!result.ok) {
    return { title: "ランキングが見つからない", robots: { index: false, follow: false } };
  }

  const payload = result.payload;
  const title = `${payload.streamer.nickname ?? "配信者"}の貢献ランキング(${periodLabelOf(payload.period)})`;

  return {
    title: `${title} | LIVE Sidestage`,
    // トークンを他サイトへ漏らさない(外部リンクを踏んだときの Referer)。
    referrer: "same-origin",
    openGraph: { title, type: "website" },
    // URLを知る人向けであってSEOの対象ではない。公開APIの X-Robots-Tag と対。
    robots: { index: false, follow: false },
  };
}

export default async function PublicContributionPage({ params }: { params: { token: string } }) {
  const result = await loadContribution(params.token);
  if (!result.ok) notFound();

  return <PublicContributionClient token={params.token} payload={result.payload} />;
}
