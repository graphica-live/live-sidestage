import { activityFromLegacyStatus, type ListenerActivity } from "./listener-state";

// TiktokRoom の listener 状態を「今この配信者は配信中か」へ正規化する。
//
// persistState()(src/lib/tiktok-listener.ts)が書く値は best effort で、
//
//   - 定期更新があるのは "connected" のときだけ(30秒の heartbeat)
//   - 書き込み失敗は握り潰される
//   - Workerが落ちればそこで更新が止まる
//
// ため、値を素直に信じると「Workerが落ちたのに配信中のまま」「一度きりの
// 接続エラーが永久に残る」といった表示になる。listenerUpdatedAt の鮮度で正規化する。
//
// **鮮度判定は activity と health の両方に掛ける。** live だけに掛けると古い error が
// 消えなくなる(モバイルのステータス表示ではエラーが最優先なので永久に赤くなる)。

/** heartbeat 30秒 × 3。これを超えた値は現在の状態として扱わない。 */
export const LISTENER_STALE_MS = 90_000;

export interface Liveness {
  /** TikTok Live へ実際に接続できている(= 配信中)。 */
  live: boolean;
  /** 値が古い/欠落している。現在の状態として扱ってはいけない。 */
  stale: boolean;
}

export function resolveLiveness(
  activity: ListenerActivity | null | undefined,
  updatedAt: Date | null | undefined,
  now: Date = new Date()
): Liveness {
  if (!updatedAt) return { live: false, stale: true };

  const age = now.getTime() - updatedAt.getTime();
  // 未来の時刻は壊れた値(サーバー間の時計ずれ・手で書き換えられた値)。
  // 「新しいから信用できる」と解釈すると永久に live のままになりうるので stale 扱いする。
  if (age < 0) return { live: false, stale: true };
  if (age > LISTENER_STALE_MS) return { live: false, stale: true };

  return { live: activity === "live", stale: false };
}

/**
 * DB の行から activity を取り出す。新しい列が空なら listenerStatus から推測する
 * （列を足す前に書かれた行、および旧Workerが書いた行）。
 */
export function activityOf(row: {
  listenerActivity?: string | null;
  listenerStatus?: string | null;
}): ListenerActivity {
  const value = row.listenerActivity;
  if (value === "live" || value === "offline" || value === "unknown") return value;
  return activityFromLegacyStatus(row.listenerStatus);
}
