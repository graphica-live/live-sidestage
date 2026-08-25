"use client";

import { useEffect, useState } from "react";

/** 破棄したときに何が消えるか。`MatchManager` が対戦一覧から作る。 */
export type BracketSummary = {
  total: number;
  /** 結果が確定している対戦(不戦勝は除く) */
  finished: number;
  /** 検知中・承認待ちの対戦 */
  running: number;
  /** 不戦勝で自動確定した行。作り直せば同じものが再生成される */
  bye: number;
  /** 消える確定結果の中身(ラウンド名 + 勝者) */
  finishedLabels: string[];
};

/** 内訳に出す確定結果の件数。多いと読まれないので頭だけ見せる。 */
const MAX_LISTED = 5;

/**
 * トーナメント表の破棄を確認する。
 *
 * **失われる結果があるときはイベント名の入力を要求する**(GitHub のリポジトリ削除と同じ)。
 * 何も進行していない表を組み替えるだけなら入力欄は出さない — 失うものがないので
 * 儀式を課しても摩擦が増えるだけ。
 *
 * 「破棄だけする」は常に入力を要求する。作り直しと違って明示的な破壊操作で、
 * かつ `createBracket` が通らない状態(参加者が2組未満・日程が縮んだ)でも使えるため。
 */
export function DestroyBracketDialog({
  eventTitle,
  eventStatus,
  summary,
  canRebuild,
  rebuildNote,
  requireConfirmText,
  busy,
  error,
  onClose,
  onRebuild,
  onDestroyOnly,
}: {
  eventTitle: string;
  eventStatus: string;
  summary: BracketSummary;
  /** 作り直しの条件が揃っているか。揃っていなくても「破棄だけ」はできる */
  canRebuild: boolean;
  /** 作り直せない理由。省略すると「2組以上の参加が要る」を出す */
  rebuildNote?: string;
  /** 作り直しにイベント名の入力が要るか(進行済みの対戦を含むとき) */
  requireConfirmText: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onRebuild: (confirm?: string) => void;
  onDestroyOnly: (confirm: string) => void;
}) {
  const [input, setInput] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const matched = input.trim() === eventTitle.trim();
  const listed = summary.finishedLabels.slice(0, MAX_LISTED);
  const rest = summary.finishedLabels.length - listed.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="destroy-bracket-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="destroy-bracket-title" className="text-lg font-semibold">
          トーナメント表を破棄する
        </h2>

        <ul className="mt-3 space-y-1 text-sm text-gray-300">
          <li>対戦カード {summary.total} 件がすべて消える。</li>
          {summary.finished > 0 && (
            <li className="text-red-300">確定した結果 {summary.finished} 件が消える。</li>
          )}
          {summary.running > 0 && (
            <li className="text-red-300">
              検知中・承認待ちの対戦 {summary.running} 件が消える。
            </li>
          )}
          {summary.bye > 0 && (
            <li className="text-gray-400">
              不戦勝 {summary.bye} 件は作り直せば同じように再生成される。
            </li>
          )}
        </ul>

        {listed.length > 0 && (
          <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-xs text-red-200/80">
            <p className="font-medium">消える結果</p>
            <ul className="mt-1 space-y-0.5">
              {listed.map((label, i) => (
                <li key={i}>{label}</li>
              ))}
              {rest > 0 && <li>ほか {rest} 件</li>}
            </ul>
          </div>
        )}

        <p className="mt-3 text-xs leading-relaxed text-gray-500">
          検知したバトルの記録そのものは消えない。時間枠が同じなら、作り直した表でも
          同じバトルが検知され直す。
        </p>
        {eventStatus === "ARCHIVED" && (
          <p className="mt-2 rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-3 py-2 text-xs text-yellow-200/80">
            このイベントはアーカイブ済みで集計が止まっている。作り直しても結果は入らない。
            先にアーカイブを解除すること。
          </p>
        )}

        {/* 「破棄だけする」は状態を問わず確認が要るので、入力欄は常に出す。
            「破棄して作り直す」だけは、失う結果が無ければ入力なしで押せる。 */}
        <div className="mt-4">
          <label htmlFor="destroy-confirm" className="label">
            確認のため <code className="select-all text-gray-200">{eventTitle}</code> と入力する
            {!requireConfirmText && (
              <span className="ml-1 text-gray-500">(「破棄だけする」に必要)</span>
            )}
          </label>
          <input
            id="destroy-confirm"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
            className="input-field w-full"
          />
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-secondary text-sm"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => onDestroyOnly(input)}
            disabled={busy || !matched}
            className="rounded-lg border border-red-400/40 px-3 py-2 text-sm text-red-300 transition hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            破棄だけする
          </button>
          <button
            type="button"
            onClick={() => onRebuild(requireConfirmText ? input : undefined)}
            disabled={busy || !canRebuild || (requireConfirmText && !matched)}
            className="rounded-lg bg-red-500/90 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            破棄して作り直す
          </button>
        </div>
        {!canRebuild && (
          <p className="mt-2 text-right text-xs text-gray-500">
            {rebuildNote ?? "作り直すには2組以上の参加が要る。"}破棄だけならできる。
          </p>
        )}
      </div>
    </div>
  );
}
