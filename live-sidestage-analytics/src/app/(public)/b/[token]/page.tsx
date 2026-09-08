import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { queryBattleReplayByShareToken } from "@/lib/battle-replay";
import { formatClock, replayTitleOf } from "@/components/analytics/battle-replay/replay-format";
import { PublicBattleClient } from "./PublicBattleClient";

// シェアリンクの公開ページ。**トークンで「どのバトルか」、クエリで「どの表示か」**を決める。
// 表示状態をトークンへ埋めると同一バトルで2トークンになり管理が壊れる。
//
// 認証は無い(URLを知っている人は誰でも見られる)。middleware の除外へ `b(?:/|$)` を
// 入れてあり、**境界を外すと `/billing` まで公開される**(src/middleware.test.ts が固定)。
//
// ペイロードは `queryBattleReplayByShareToken` の公開バリアントで、配信者・リスナーとも
// TikTokハンドル(`tiktokHandle`)を含まない。ここでサーバー側が1回だけ読み、クライアントへ
// 渡す(再生・一覧の両モードが同じデータを使うので、モードごとに fetch しない)。
export const dynamic = "force-dynamic";

/** `generateMetadata` と本体で二重にDBを引かないための同一リクエスト内キャッシュ。 */
const loadReplay = cache(async (token: string) => queryBattleReplayByShareToken(token));

/** 再生ペイロードから OGP 用のタイトルを組む(モーダルのヘッダと同じ関数)。 */
function titleOf(teams: { isSelf: boolean; participants: { displayName: string }[] }[]): string {
  return replayTitleOf(
    teams.map((team) => ({
      isSelf: team.isSelf,
      participants: team.participants.map((p) => ({ label: p.displayName })),
    }))
  );
}

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const result = await loadReplay(params.token);
  // **トークンの存否を出し分けない。** 見つからない場合と再生不可の場合で同じ扱いにする。
  if (!result.ok) {
    return { title: "バトルが見つからない", robots: { index: false, follow: false } };
  }

  const payload = result.payload;
  const title = titleOf(payload.teams);
  const scores = payload.teams
    .map((team) => (team.officialScore === null ? "—" : Number(team.officialScore).toLocaleString("ja-JP")))
    .join(" - ");
  const description = `${scores} ・ ${new Date(payload.startedAt).toLocaleString("ja-JP")} ・ ${formatClock(payload.durationMs)}`;

  return {
    title: `${title} | LIVE Sidestage`,
    description,
    // トークンを他サイトへ漏らさない(外部リンクを踏んだときの Referer)。
    referrer: "same-origin",
    openGraph: { title, description, type: "website" },
    // URLを知る人向けであってSEOの対象ではない。公開APIの X-Robots-Tag と対。
    robots: { index: false, follow: false },
  };
}

export default async function PublicBattlePage({
  params,
  searchParams,
}: {
  params: { token: string };
  // **`useSearchParams` は使わない**(overlay で本番だけ壊れた経緯があるため、
  // クエリはサーバーコンポーネントの props で受ける)。
  searchParams: { v?: string };
}) {
  const result = await loadReplay(params.token);
  if (!result.ok) notFound();

  return (
    <PublicBattleClient
      payload={result.payload}
      title={titleOf(result.payload.teams)}
      initialMode={searchParams.v === "list" ? "list" : "replay"}
    />
  );
}
