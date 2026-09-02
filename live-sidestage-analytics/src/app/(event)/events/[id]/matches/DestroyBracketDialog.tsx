"use client";

import { useEffect, useState } from "react";

/** 破棄したときに何が消えるか。`MatchManager` が対戦一覧から作る。 */
export type BracketSummary = {
  total: number;
  /** 結果が確定している対戦(不戦勝は除く) */
  finished: number;
  /** 検知中・承認待ちの対戦 */
  running: number;
  /** 不戦勝で自動確定した行。同じ組み合わせで作り直せば同じものが再生成される */
  bye: number;
  /** 消える確定結果の中身(ラウンド名 + 勝者) */
  finishedLabels: string[];
};

/** 内訳に出す確定結果の件数。多いと読まれないので頭だけ見せる。 */
const MAX_LISTED = 5;

/**
 * トーナメント表の破棄を確認する。
 *
 * **表がある状態でできるのは破棄だけ**なので、ここから作り直しは走らせない
 * (破棄したあと、あらためて「表を作る」から組む)。明示的な破壊操作なので、進行状態に
 * かかわらずイベント名の入力を要求する — GitHub のリポジトリ削除と同じ。
 *
 * 件数と内訳は**ダイアログを開いた時点のスナップショット**。集計は10秒ごとに回るので、
 * 入力しているあいだに結果が増えることはある(サーバーが見るのは「同じ表かどうか」だけ)。
 */
export function DestroyBracketDialog({
  eventTitle,
  eventStatus,
  summary,
  busy,
  error,
  onClose,
  onDestroy,
}: {
  eventTitle: string;
  eventStatus: string;
  summary: BracketSummary;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onDestroy: (confirm: string) => void;
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

        <ul className="mt-3 space-y-1 text-sm text-strong">
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
            <li className="text-muted">
              不戦勝 {summary.bye} 件は、同じ組み合わせで作り直せば同じように再生成される。
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

        <p className="mt-3 text-xs leading-relaxed text-muted">
          破棄すると表が無い状態になる。作り直すときは、このあと「表を作る」から日程と
          組み合わせを決め直す。検知したバトルの記録そのものは消えないので、日程が同じなら
          新しい表でも同じバトルが検知され直す。
        </p>
        {eventStatus === "ARCHIVED" && (
          <p className="mt-2 rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-3 py-2 text-xs text-yellow-200/80">
            このイベントはアーカイブ済みで集計が止まっている。表を作り直しても結果は入らない。
            先にアーカイブを解除すること。
          </p>
        )}

        {/* 明示的な破壊操作なので、進行状態を問わず入力を求める。 */}
        <div className="mt-4">
          <label htmlFor="destroy-confirm" className="label">
            確認のため <code className="select-all text-strong">{eventTitle}</code> と入力する
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

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

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
            onClick={() => onDestroy(input)}
            disabled={busy || !matched}
            className="rounded-lg bg-red-500/90 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            表を破棄する
          </button>
        </div>
      </div>
    </div>
  );
}
