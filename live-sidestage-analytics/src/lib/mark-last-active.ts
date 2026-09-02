import { prisma } from "@/lib/prisma";

// 「ログイン」ではなく「アクティブ」を記録する。Webはlong-lived JWTセッション、
// モバイルは90日有効トークンなので、日常的に使っているユーザーでも
// 再ログインが90日以上発生しないことが普通にある。呼び出し側は区別せず、
// ログイン成功時・セッション/トークン検証時のどちらからも同じ関数を呼べばよい
// (スロットルはここに一本化してあるので、呼び出し頻度の高い箇所からfire-and-forgetで
// 呼んでも書き込みは過剰にならない)。
const THROTTLE_MS = 24 * 60 * 60 * 1000;

// updateMany() を使うのは、対象Userがモバイルのアカウント削除等で既に消えている場合に
// update() のP2025 throwを避けるため。呼び出し元の処理(ログイン/APIリクエスト)を
// 失敗させたくないので、例外は握りつぶしログのみ。
//
// revive(監視復活)とlastActiveAt更新は別々にtry/catchする(実装後レビューで指摘)。
// 同じtry内でupdateMany→revive の順に実行すると、updateManyだけ成功しreviveが
// 例外で失敗した場合、lastActiveAtは既に更新済みのままreviveだけ握り潰される。
// 直後の24時間はisStale判定でmarkLastActive本体がスキップされるため、一時的なDB障害
// 等でreviveだけ失敗すると最大24時間、監視停止状態から復活できなくなる。
// reviveはスロットル対象外にして毎回試行する(streamer 1件取得+条件付きupdateManyで、
// 監視停止中でなければ実質no-opなので毎回呼んでもコストは軽い)。
export async function markLastActive(userId: string): Promise<void> {
  try {
    await reviveSuspendedMonitoring(userId);
  } catch (err) {
    console.error("[mark-last-active] 監視復活処理に失敗:", err);
  }

  try {
    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { lastActiveAt: true } });
    if (!existing) return;

    const isStale = !existing.lastActiveAt || Date.now() - existing.lastActiveAt.getTime() > THROTTLE_MS;
    if (!isStale) return;

    await prisma.user.updateMany({ where: { id: userId }, data: { lastActiveAt: new Date() } });
  } catch (err) {
    console.error("[mark-last-active] 更新に失敗:", err);
  }
}

// ユーザーが監視停止(monitoringSuspended)されたRoomに紐づいている場合、アクティブ化を
// 検知した時点で即座に監視を復活させる。低価値クリーンアップ(tiktok-low-value-cleanup.ts)
// 由来・NOT_FOUND判定(tiktok-room-cleanup.ts)由来のどちらの停止も同じフラグ・同じ経路で
// 復活する。「ログインし直せば監視復活する」という運用意図を、次回クリーンアップrunを
// 待たずに実現するための能動的な巻き戻し。
//
// NOT_FOUND判定用フィールド(unhealthySince/notFoundStreak/notFoundFirstAt/
// lastExistenceCheckAt)も同時にリセットする。停止時にこれらを残したままだと、復活後
// 最初の実在確認で古いstreakを引き継いでしまい、TikTok側が実際には復帰していても
// 誤って早期に再停止しかねない。低価値クリーンアップ由来の停止ではこれらは元々null
// なのでリセットしても影響しない。
async function reviveSuspendedMonitoring(userId: string): Promise<void> {
  const streamer = await prisma.streamer.findUnique({
    where: { userId },
    select: { roomId: true },
  });
  if (!streamer?.roomId) return;

  await prisma.tiktokRoom.updateMany({
    where: { id: streamer.roomId, monitoringSuspended: true },
    data: {
      monitoringSuspended: false,
      unhealthySince: null,
      notFoundStreak: 0,
      notFoundFirstAt: null,
      lastExistenceCheckAt: null,
    },
  });
}
