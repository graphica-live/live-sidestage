// room 監視要求(TiktokRoom.monitorUntil)の期限計算。純粋関数だけを置く(テスト対象)。
//
// このファイルは依存を持たない。tiktok-room.ts(prisma を触る側)からも
// src/event 配下からも読めるようにするため。

/** イベント終了後も監視を続ける猶予。終了間際のギフトの取りこぼしを防ぐ。 */
export const LEASE_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * 1回の要求で受け付ける監視期限の上限(日)。
 *
 * イベント期間の上限(90日) + 猶予 + ある程度の事前登録期間を吸収できる値。
 * 実際に上限を課すのは `ensureRoomForEvent`(tiktok-room.ts)で、ここはその値の唯一の定義。
 */
export const MAX_LEASE_DAYS = 120;

export type LeaseWindow = {
  /** 本来必要な期限(イベント終了 + 猶予)。EventRoomLease にはこちらを保存する */
  requested: Date;
  /** 実際に TiktokRoom へ渡す期限。上限を超える分は切り詰める */
  granted: Date;
  /** 切り詰めが発生したか。true のときは期限が来る前に再要求が要る */
  clamped: boolean;
};

/**
 * イベント終了日時から監視期限を決める。
 *
 * 遠い将来のイベント(終了が120日以上先)は受け付けられないため切り詰める。
 * 切り詰めた場合、granted が切れる前に再要求しないと監視が途中で止まる。
 * 再要求はイベント集計ワーカーの `renewClampedLeases` が担当する。
 */
export function computeLeaseWindow(endAt: Date, now: Date = new Date()): LeaseWindow {
  const requested = new Date(endAt.getTime() + LEASE_GRACE_MS);
  const maxUntil = new Date(now.getTime() + MAX_LEASE_DAYS * 24 * 60 * 60 * 1000);

  if (requested <= maxUntil) {
    return { requested, granted: requested, clamped: false };
  }
  return { requested, granted: maxUntil, clamped: true };
}
