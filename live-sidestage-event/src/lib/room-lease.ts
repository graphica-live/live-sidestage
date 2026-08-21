// room 監視要求の期限計算。純粋関数だけを置く(テスト対象)。

/** イベント終了後も監視を続ける猶予。終了間際のギフトの取りこぼしを防ぐ。 */
export const LEASE_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * analytics 側が1回のリクエストで受け付ける期限の上限(日)。
 * **live-sidestage-analytics の MAX_LEASE_DAYS と必ず揃えること。**
 * (src/app/api/internal/event-room-lease/route.ts)
 */
export const ANALYTICS_MAX_LEASE_DAYS = 120;

export type LeaseWindow = {
  /** 本来必要な期限(イベント終了 + 猶予)。EventRoomLease にはこちらを保存する */
  requested: Date;
  /** analytics へ実際に渡す期限。上限を超える分は切り詰める */
  granted: Date;
  /** 切り詰めが発生したか。true のときは期限が来る前に再要求が要る */
  clamped: boolean;
};

/**
 * イベント終了日時から監視期限を決める。
 *
 * 遠い将来のイベント(終了が120日以上先)は analytics 側が受け付けないため切り詰める。
 * 切り詰めた場合、granted が切れる前に再要求しないと監視が途中で止まる。
 * 再要求はフェーズ3の集計ワーカーが担当する予定で、それまでは主催者が参加者を
 * 登録し直すことで復旧できる(UI に警告を出す)。
 */
export function computeLeaseWindow(endAt: Date, now: Date = new Date()): LeaseWindow {
  const requested = new Date(endAt.getTime() + LEASE_GRACE_MS);
  const maxUntil = new Date(now.getTime() + ANALYTICS_MAX_LEASE_DAYS * 24 * 60 * 60 * 1000);

  if (requested <= maxUntil) {
    return { requested, granted: requested, clamped: false };
  }
  return { requested, granted: maxUntil, clamped: true };
}
