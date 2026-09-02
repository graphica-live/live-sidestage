"use client";

import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  BattleVersus,
  BATTLE_STATUS_LABELS,
  type BattleContributorsData,
  type BattleListItem,
} from "./battle-types";

// バトル履歴の行クリックで開く対戦詳細モーダル。以前は行内アコーディオン展開だったが、
// 公開トーナメント表の対戦詳細モーダル(MatchDetailModal.tsx)と表示形式を揃えるため変更した。
//
// 貢献者は自分側のみ(queryBattleContributorsがviewerStreamerId基準で自room宛のギフトしか
// 取得できないため、公開トーナメント表のような左右横並びは不採用)。

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: BattleContributorsData };

export function BattleDetailModal({
  battle,
  onClose,
}: {
  battle: BattleListItem | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<LoadState | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!battle) return;
    let cancelled = false;
    setState({ status: "loading" });

    void (async () => {
      try {
        const res = await fetch(`/api/analytics/battles/${encodeURIComponent(battle.battleId)}/contributors`);
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const data = (await res.json()) as BattleContributorsData;
        if (!cancelled) setState({ status: "ready", data });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [battle]);

  useEffect(() => {
    if (!battle) return;
    closeButtonRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [battle, onClose]);

  if (!battle) return null;

  const opponent = battle.opponent;
  const bothScores = battle.selfScore !== null && battle.opponentScore !== null;
  const win = bothScores && BigInt(battle.selfScore!) > BigInt(battle.opponentScore!);
  const lose = bothScores && BigInt(battle.selfScore!) < BigInt(battle.opponentScore!);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 py-10 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative mx-auto w-full max-w-lg rounded-xl border border-white/10 bg-panel p-5 sm:p-6"
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

        <div className="pr-8">
          <div className="text-xs text-muted">{new Date(battle.startedAt).toLocaleString("ja-JP")}</div>

          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {battle.selfTeam && battle.opponentTeam ? (
                <BattleVersus selfTeam={battle.selfTeam} opponentTeam={battle.opponentTeam} size="md" />
              ) : opponent === null ? (
                <span className="text-muted text-sm">対戦相手不明</span>
              ) : opponent.count > 1 ? (
                <span className="text-muted text-sm">複数人バトル({opponent.count + 1}人)</span>
              ) : opponent.nickName || opponent.displayId || opponent.tiktokId ? (
                <>
                  <Avatar src={opponent.avatarUrl} alt={opponent.nickName ?? opponent.displayId ?? "?"} />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{opponent.nickName ?? `@${opponent.displayId}`}</div>
                    {(opponent.displayId || opponent.tiktokId) && (
                      <div className="text-xs text-muted truncate">@{opponent.displayId ?? opponent.tiktokId}</div>
                    )}
                  </div>
                </>
              ) : (
                <span className="text-muted text-sm">対戦相手不明</span>
              )}
            </div>
            <span
              className={`text-xs shrink-0 ${
                battle.status === "live"
                  ? "text-brand"
                  : battle.status === "cut_short"
                    ? "text-red-600 dark:text-red-400"
                    : "text-muted"
              }`}
            >
              {BATTLE_STATUS_LABELS[battle.status]}
            </span>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm font-mono">
            <span>
              {battle.selfScore === null ? "-" : (
                <span className={win ? "text-brand font-semibold" : ""}>{Number(battle.selfScore).toLocaleString()}</span>
              )}
              {" / "}
              {battle.opponentScore === null ? "-" : (
                <span className={lose ? "text-red-600 dark:text-red-400 font-semibold" : ""}>{Number(battle.opponentScore).toLocaleString()}</span>
              )}
            </span>
            <span className="text-muted">💎{battle.selfTotalDiamonds.toLocaleString()}</span>
          </div>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <div className="text-xs text-muted mb-2">貢献者</div>
          {state?.status === "loading" && (
            <div className="text-center py-6 text-muted text-xs">読み込み中...</div>
          )}
          {state?.status === "error" && (
            <div className="text-center py-6 text-muted text-xs">貢献者一覧を取得できなかった。</div>
          )}
          {state?.status === "ready" && (
            state.data.contributors.length === 0 ? (
              <div className="text-center py-6 text-muted text-xs">
                {state.data.status === "unknown"
                  ? "バトル区間を確定できないため集計できません"
                  : "このバトルへの貢献者なし"}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {state.data.contributors
                  .slice()
                  .sort((a, b) => b.totalDiamonds - a.totalDiamonds)
                  .map((c) => (
                    <div key={c.uniqueId} className="flex items-center gap-2 text-xs">
                      <Avatar src={c.profileImageUrl} alt={c.nickname} />
                      <span className="font-medium truncate max-w-[160px]">{c.nickname}</span>
                      <span className="text-muted">@{c.uniqueId}</span>
                      <span className="ml-auto font-mono">
                        💎{c.totalDiamonds.toLocaleString()} ({c.giftCount}件)
                      </span>
                    </div>
                  ))}
              </div>
            )
          )}
        </div>
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
