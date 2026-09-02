"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicMatchDetail } from "@/event/match-detail";
import { CARD_CLIP } from "../battle-ui";
import { MatchDetailBody } from "./match-detail-ui";

// 対戦カードタップで開く対戦詳細モーダル。以前は `/e/{slug}/bracket/{matchId}` への
// 別ページ遷移だったが、表に多数並ぶカードの中から見比べたい・すぐ表に戻りたいという
// 用途にはページ遷移が重かったため、その場で開閉するモーダルへ変えた(デザイン変更)。
//
// **`matchId` が null のときは何も描画しない。** カードをタップするまでこの詳細API
// (バトルごとのギフト集計を伴いうる)を叩かない — 以前の `prefetch={false}` と同じ
// 意図(表に並ぶ全カード分を先読みしない)を、そもそもフェッチ自体を遅延させることで
// さらに徹底している。

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; detail: PublicMatchDetail };

export function MatchDetailModal({
  slug,
  matchId,
  onClose,
}: {
  slug: string;
  matchId: string | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<LoadState | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    setState({ status: "loading" });

    void (async () => {
      try {
        const res = await fetch(
          `/api/public/events/${encodeURIComponent(slug)}/bracket/${encodeURIComponent(matchId)}`,
          { cache: "no-store" }
        );
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const detail = (await res.json()) as PublicMatchDetail;
        if (!cancelled) setState({ status: "ready", detail });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, matchId]);

  useEffect(() => {
    if (!matchId) return;
    closeButtonRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    // 背後の表がスクロールしないようにする。閉じたら必ず元の値へ戻す。
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [matchId, onClose]);

  if (!matchId) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 py-10 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`relative mx-auto w-full max-w-2xl border border-border bg-panel p-5 sm:p-6 ${CARD_CLIP}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-row-hover hover:text-strong"
        >
          <CloseIcon />
        </button>

        {state?.status === "loading" && (
          <p className="py-16 text-center text-sm text-muted">読み込み中…</p>
        )}
        {state?.status === "error" && (
          <p className="py-16 text-center text-sm text-muted">対戦詳細を取得できなかった。</p>
        )}
        {state?.status === "ready" && <MatchDetailBody detail={state.detail} />}
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}
