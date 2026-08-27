"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BracketDto } from "@/event/public-event";
import { BracketTree } from "./BracketTree";

// 公開トーナメント表をリロードなしで進める。
//
// 勝者の転送は主催者の操作(`[matchId]` の PATCH)と集計ワーカーの両方で起きるが、
// このページは `force-dynamic` の RSC で、**再取得の仕組みを持っていなかった**。
// 順位表(`EventResults`)だけが別途ポーリングしていて、その API にブラケットは入っていない。
//
// 引くのは専用の軽量API1本だけ。`router.refresh()` にすると、順位表の5クエリや
// バトルスコアまでページ全体を毎回引き直すことになる。

/** 集計ワーカーが10秒周期なので、それより短く引いても新しい値は出てこない。 */
const POLL_INTERVAL_MS = 10_000;

type Payload = {
  status: string;
  finalizedAt: string | null;
  bracket: BracketDto | null;
};

export function BracketLive({
  slug,
  initial,
  initialStatus,
  initialFinalizedAt,
  empty = null,
}: {
  slug: string;
  initial: BracketDto | null;
  initialStatus: string;
  /** ISO 文字列。null なら集計がまだ続いている = 表もまだ動きうる。 */
  initialFinalizedAt: string | null;
  /** 表が無いときに出すもの。トップページのように「出さない」なら null。 */
  empty?: ReactNode;
}) {
  const [bracket, setBracket] = useState<BracketDto | null>(initial);
  const [status, setStatus] = useState(initialStatus);
  const [finalizedAt, setFinalizedAt] = useState(initialFinalizedAt);
  // 前のリクエストが返る前に次を出さない(遅い回線で積み上がるのを防ぐ)。
  const inFlight = useRef(false);

  useEffect(() => {
    // **`RUNNING` 限定にしない。** `aggregationWindow()` は FINISHED も集計対象にしていて、
    // 主催者が早めに終了にしても勝敗・進行は変わりうる。逆に SCHEDULED のまま開いていた
    // ページも、開始後に進み始めるので引き続ける。止めるのは集計側と同じ条件だけ。
    if (status === "ARCHIVED" || finalizedAt !== null) return;

    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (inFlight.current) return;
      inFlight.current = true;
      void (async () => {
        try {
          const res = await fetch(`/api/public/events/${encodeURIComponent(slug)}/bracket`, {
            cache: "no-store",
          });
          if (!res.ok) return;
          const payload = (await res.json()) as Payload;
          setBracket(payload.bracket);
          setStatus(payload.status);
          setFinalizedAt(payload.finalizedAt);
        } catch {
          // 一時的な通信断で表示を壊さない。次のティックで取り直す。
        } finally {
          inFlight.current = false;
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [slug, status, finalizedAt]);

  if (!bracket) return <>{empty}</>;

  // **ラウンド数が変わったら作り直させる。** `BracketScroller` の縮小率はマウント時に
  // 一度だけ測るので、表を作り直して段数が変わると古い倍率のまま残る。
  return (
    <BracketTree
      key={bracket.roundCount}
      roundCount={bracket.roundCount}
      matches={bracket.matches}
      // ローリングデプロイ中、旧インスタンスの応答には `feederFlows` が無い可能性がある。
      feederFlows={bracket.feederFlows ?? []}
    />
  );
}
