// worker→webのsyncTrigger(ranking/gift-history/battle-history)を実際に処理する
// web側の入口。**サーバー専用**(prismaを引くbuilderを呼ぶ)。
//
// tiktok-listener.tsの`!isWorkerProcess`分岐(web単独プロセス)と
// `/api/internal/gift-event/route.ts`(worker→webの転送先)の両方から呼ばれる、
// 同一の「build → emit」ロジックの単一の置き場所。
//
// **chat-feed.tsから直接importしない設計にしてある。** chat-ranking.tsがchat-feed.tsの
// emit関数を呼ぶ一方向依存があるため、chat-feed.ts側からchat-ranking.ts/gift-history.ts/
// battle-history.tsへ値としてimportし返すと循環importになる
// (chat-feed.tsのoverlay/timer.server.ts動的importコメントと同じ理由の対策)。
// このモジュールが両方向のimportを一手に引き受けることで循環を避ける。

import { buildGiftHistoryEventById } from "@/lib/gift-history";
import { buildBattleSummaryById } from "@/lib/battle-history";
import { emitChatGiftHistoryAppend, emitChatBattleHistoryUpsert } from "@/lib/chat-feed";
import { scheduleRankingSnapshotEmit } from "@/lib/chat-ranking";

/**
 * 貢献ランキングのsnapshot push。**drop許容**(scheduleRankingSnapshotEmit自体が
 * throttleで間引く設計であり、次のギフトで再送されれば自己修復するため)。
 */
export function applyRankingSyncTrigger(roomId: string, streamerIds: string[]): void {
  scheduleRankingSnapshotEmit(roomId, streamerIds);
}

/**
 * ギフト履歴1件のappend push。**呼び出し元(tiktok-listener.tsの専用非dropキュー)が
 * 有限回リトライする前提**なので、配信できたかをbooleanで返す
 * (false=io未初期化などで再送してよい失敗、例外はログのみで再送不要な失敗として扱う)。
 *
 * 該当Gift行が既に無い(削除済み・保持期間超過)場合はtrueを返す — io不達ではないので
 * リトライしても状況は変わらない。
 */
export async function applyGiftHistorySyncTrigger(
  streamerIds: string[],
  giftId: string
): Promise<boolean> {
  const event = await buildGiftHistoryEventById(giftId);
  if (!event) return true;

  for (const streamerId of streamerIds) {
    const delivered = await emitChatGiftHistoryAppend(streamerId, event).catch((err) => {
      console.error("[realtime-sync] gift-history emit error:", err);
      return true; // 例外は再送しても解決しないビジネスロジックエラー扱い(既存chatGiftEvent等と同じ倒し方)
    });
    if (!delivered) return false;
  }
  return true;
}

/**
 * バトル履歴1件のupsert push。applyGiftHistorySyncTriggerと同じ契約(booleanで
 * リトライ要否を返す)。該当バトルが見つからない場合はtrue(io不達ではない)。
 */
export async function applyBattleHistorySyncTrigger(
  streamerIds: string[],
  roomId: string,
  battleId: string
): Promise<boolean> {
  const summary = await buildBattleSummaryById(roomId, battleId);
  if (!summary) return true;

  for (const streamerId of streamerIds) {
    const delivered = await emitChatBattleHistoryUpsert(streamerId, summary).catch((err) => {
      console.error("[realtime-sync] battle-history emit error:", err);
      return true;
    });
    if (!delivered) return false;
  }
  return true;
}
