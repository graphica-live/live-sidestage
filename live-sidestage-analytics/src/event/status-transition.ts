// イベントのステータス遷移表。**UI と API が同じ表を見る。**
//
// 統合前はクライアント(EventAdminControls)にしか表が無く、API は列挙値でありさえすれば
// どこからどこへでも飛ばせた。表をここへ出して両方が参照する。
//
// `RUNNING` への遷移は集計ワーカーの対象になることを意味する(aggregate.ts の
// `aggregationWindow`)。**終了については status を見ない**ので、
// `RUNNING` から出る遷移が集計を止めるわけではない点に注意
// (`FINISHED` も集計対象。打ち切りは `finalizedAt`)。

import type { EventStatus } from "./validation";

export type StatusTransition = { to: EventStatus; label: string };

export const STATUS_TRANSITIONS: Record<EventStatus, StatusTransition[]> = {
  // 開催準備中 → 開催中。**ここだけ開催準備チェック(readiness.ts)を課す。**
  SCHEDULED: [{ to: "RUNNING", label: "開催中にする" }],
  // 誤って開催中にしたときに戻せるようにする。集計対象から外れるだけで、
  // 既に書かれた順位表のスナップショットは消さない(RUNNING に戻せば次の周回で上書きされる)。
  RUNNING: [
    { to: "SCHEDULED", label: "開催準備中に戻す" },
    { to: "FINISHED", label: "終了にする" },
  ],
  FINISHED: [
    { to: "RUNNING", label: "開催中に戻す" },
    { to: "ARCHIVED", label: "アーカイブする" },
  ],
  ARCHIVED: [{ to: "FINISHED", label: "アーカイブを解除する" }],
};

/**
 * 遷移が許可されているか。
 *
 * **同じ status への遷移(no-op)は許可する。** 別タブで先に同じ操作が通っていた場合や、
 * 二重クリックでエラーを出す意味がない(結果として望んだ状態になっている)。
 * 未知の status からの遷移は許可しない(`EventStatus` は DB の enum ではなく文字列なので、
 * 想定外の値が入っていたら操作を通さない fail closed)。
 */
export function isAllowedStatusTransition(from: string, to: string): boolean {
  if (from === to) return true;
  const transitions = STATUS_TRANSITIONS[from as EventStatus];
  if (!transitions) return false;
  return transitions.some((t) => t.to === to);
}
