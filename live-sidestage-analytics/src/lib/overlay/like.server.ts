// Like(いいね)の日次累計。**サーバー専用**(prisma を引く)。tap-list / like-contribution が共有する。
//
// 単発イベントのログは保持しない方針(データ量爆発回避)。呼び出しは「イベントにつき1回」に
// 限定すること — roomId軸で複数Streamerが共有するテーブルなので、購読者ごとに複製して
// 呼ぶと合計が購読者数倍になる(tiktok-listener.ts側のstreamerIds一括転送とセットで守る)。

import { prisma } from "@/lib/prisma";
import { jstDateKey } from "./day-key";
import { emitOverlayUpdate, emitLikeMilestone } from "./emit";
import { loadLikeContributionSettings } from "./like-contribution.server";

export async function recordLike(
  roomId: string,
  uniqueId: string,
  nickname: string,
  profileImageUrl: string | null,
  likeCount: number
): Promise<{ dayKey: string; previousTotal: number; newTotal: number }> {
  const dayKey = jstDateKey();
  // 「更新前合計」はfindUnique+upsertの2ステップ・トランザクションでは
  // READ COMMITTED下で並行リクエスト間の競合(同じprevを読んで同じマイルストーンを
  // 二重発火する)が起きるため使わない。upsertの戻り値(更新後totalLikes)から
  // 逆算する方が正確かつシンプル。
  const row = await prisma.likeTally.upsert({
    where: { roomId_dayKey_uniqueId: { roomId, dayKey, uniqueId } },
    create: { roomId, dayKey, uniqueId, nickname, profileImageUrl, totalLikes: likeCount },
    // nicknameが空文字のイベントで既存の良い値を上書きしないよう、非空のときだけ渡す。
    update: {
      totalLikes: { increment: likeCount },
      ...(nickname ? { nickname } : {}),
      ...(profileImageUrl ? { profileImageUrl } : {}),
    },
  });
  return { dayKey, previousTotal: row.totalLikes - likeCount, newTotal: row.totalLikes };
}

/** previousTotal→newTotal の間に跨いだ interval の倍数(マイルストーン)をすべて返す。 */
export function crossedMilestones(previousTotal: number, newTotal: number, interval: number): number[] {
  if (interval <= 0) return [];
  const from = Math.floor(previousTotal / interval);
  const to = Math.floor(newTotal / interval);
  if (to <= from) return [];
  return Array.from({ length: to - from }, (_, i) => (from + i + 1) * interval);
}

/** 古い日付のLikeTally行を削除する(誰にも読まれず無期限に蓄積するのを防ぐ)。 */
export async function pruneOldLikeTallies(olderThanDays = 7): Promise<number> {
  const cutoff = jstDateKey(-olderThanDays);
  const result = await prisma.likeTally.deleteMany({ where: { dayKey: { lt: cutoff } } });
  return result.count;
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
