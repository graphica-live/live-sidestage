// Like(いいね)の日次累計。**サーバー専用**。tap-list / like-contribution が共有する。
// 実データはプロセス内インメモリストア(like-tally-store.ts、旧LikeTallyテーブルの置き換え)。
//
// 単発イベントのログは保持しない方針(データ量爆発回避)。呼び出しは「イベントにつき1回」に
// 限定すること — roomId軸で複数Streamerが共有するストアなので、購読者ごとに複製して
// 呼ぶと合計が購読者数倍になる(tiktok-listener.ts側のstreamerIds一括転送とセットで守る)。

import { emitOverlayUpdate, emitLikeMilestone } from "./emit";
import { loadLikeContributionSettings } from "./like-contribution.server";
import { incrementLike } from "./like-tally-store";

export async function recordLike(
  roomId: string,
  uniqueId: string,
  nickname: string,
  profileImageUrl: string | null,
  likeCount: number
): Promise<{ dayKey: string; previousTotal: number; newTotal: number }> {
  return incrementLike(roomId, uniqueId, nickname, profileImageUrl, likeCount);
}

/** previousTotal→newTotal の間に跨いだ interval の倍数(マイルストーン)をすべて返す。 */
export function crossedMilestones(previousTotal: number, newTotal: number, interval: number): number[] {
  if (interval <= 0) return [];
  const from = Math.floor(previousTotal / interval);
  const to = Math.floor(newTotal / interval);
  if (to <= from) return [];
  return Array.from({ length: to - from }, (_, i) => (from + i + 1) * interval);
}

/**
 * 1件のlikeイベント(Worker側で1秒コアレッシング済みの合算値)を適用する。
 * **recordLikeはこの関数内で1回だけ呼ぶ**(streamerIds個別には呼ばない)。
 * その後streamerIdsをループしてtap-listの再集計emitとlike-contributionの
 * マイルストーン判定・ad-hoc通知emitを行う。
 */
export async function applyLikeEventInProcess(input: {
  streamerIds: string[];
  roomId: string;
  uniqueId: string;
  nickname: string;
  profilePictureUrl: string | null;
  likeCount: number;
}): Promise<void> {
  const { previousTotal, newTotal } = await recordLike(
    input.roomId,
    input.uniqueId,
    input.nickname,
    input.profilePictureUrl,
    input.likeCount
  );

  for (const streamerId of input.streamerIds) {
    await emitOverlayUpdate(streamerId, "tap-list").catch((err) =>
      console.error("[like] tap-list emit error:", err)
    );

    const settings = await loadLikeContributionSettings(streamerId);
    if (!settings) continue;
    const milestones = crossedMilestones(previousTotal, newTotal, settings.interval);
    for (const milestoneCount of milestones) {
      emitLikeMilestone(streamerId, {
        id: `${input.uniqueId}:${milestoneCount}:${newTotal}`,
        uniqueId: input.uniqueId,
        nickname: input.nickname,
        profileImageUrl: input.profilePictureUrl,
        milestoneCount,
        totalLikes: newTotal,
        occurredAt: new Date().toISOString(),
      });
    }
  }
}
