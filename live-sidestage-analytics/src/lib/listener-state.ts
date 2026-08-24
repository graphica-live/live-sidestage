// TiktokRoom.listenerStatus を「配信しているか(activity)」と「接続が健全か(health)」の
// 2軸へ正規化する。
//
// なぜ分けるか: listenerStatus は片方向の遷移ラベルでしかなく、実際には
//
//   - 配信していない          → "retrying" (reason=user_offline / stream_end)
//   - 署名APIのレート制限中   → "retrying" (reason=rate_limited)
//   - WebSocket断・接続失敗   → "retrying" (reason=disconnected / connect_failed / error)
//
// が全部同じ値になる。しかも updateState(..., "error") は tiktok-listener.ts の中で
// 一度も呼ばれていない。この状態では「配信開始待ち」と「TikTok側の障害」を区別できない。
//
// **listenerStatus 自体の意味は変えない。** tiktok-room-cleanup.ts の候補抽出などが
// 依存しているため、ここでの正規化は追加の列(listenerActivity/listenerHealth)へ書く。

/** 配信しているか。TikTok Live 接続が張れているかで判断する。 */
export type ListenerActivity = "live" | "offline" | "unknown";

/** こちら側の接続が健全か。配信の有無とは独立。 */
export type ListenerHealth = "ok" | "connecting" | "error";

export interface ListenerFacts {
  activity: ListenerActivity;
  health: ListenerHealth;
  /** 画面に出す日本語。listenerMessage に保存する。 */
  message: string;
}

/**
 * scheduleReconnect() が使う reason。ここに無い値は unknown/error として扱う
 * （新しい reason を足したときに黙って「配信中」にならない側へ倒す）。
 */
export type ReconnectReason =
  | "user_offline"
  | "stream_end"
  | "rate_limited"
  | "disconnected"
  | "connect_failed"
  | "error";

/**
 * 再接続待機に入るときの facts。
 *
 * メッセージは**そのままユーザーへ出す**。以前は `再接続待機中... (connect_failed)` のような
 * 開発者向け文字列で、モバイルのステータス欄に出しても何も伝わらなかった。
 * reason コード自体は listenerReason に別途保存するので、文面から消してよい。
 */
export function factsForReconnect(reason: string, retryDelayMs?: number): ListenerFacts {
  switch (reason) {
    // 配信していないだけ。異常ではない。
    case "user_offline":
      return { activity: "offline", health: "ok", message: "配信が始まるのを待っています" };
    case "stream_end":
      return {
        activity: "offline",
        health: "ok",
        message: "配信が終了しました。次の配信を待っています",
      };

    // TikTok 側の都合でこちらが繋げていない。配信中かどうかは分からない。
    case "rate_limited": {
      const minutes = retryDelayMs ? Math.ceil(retryDelayMs / 60_000) : null;
      return {
        activity: "unknown",
        health: "error",
        message: minutes
          ? `配信認証の混雑により接続を待機中です。約${minutes}分後に自動で再接続します`
          : "配信認証の混雑により接続を待機中です。自動で再接続します",
      };
    }
    case "disconnected":
      return {
        activity: "unknown",
        health: "connecting",
        message: "TikTokとの接続が切れました。まもなく再接続します",
      };
    case "connect_failed":
      return {
        activity: "unknown",
        health: "error",
        message: "TikTokへの接続に失敗しました。まもなく再接続します",
      };
    default:
      return {
        activity: "unknown",
        health: "error",
        message: "TikTokとの通信でエラーが発生しました。まもなく再接続します",
      };
  }
}

export const FACTS_CONNECTING: ListenerFacts = {
  activity: "unknown",
  health: "connecting",
  message: "TikTokへ接続しています",
};

export const FACTS_CONNECTED: ListenerFacts = {
  activity: "live",
  health: "ok",
  message: "配信に接続しました",
};

/** 監視対象から外れて接続をやめた状態。配信しているかどうかは分からない。 */
export const FACTS_IDLE: ListenerFacts = {
  activity: "unknown",
  health: "ok",
  message: "この配信者の監視は停止中です",
};

/**
 * 新しい列が入る前に書かれた行のための後方互換。
 *
 * listenerActivity が空なら listenerStatus から推測する。**"connected" だけを live と
 * みなす**（retrying は理由が分からないので offline と断定できない）。
 */
export function activityFromLegacyStatus(status: string | null | undefined): ListenerActivity {
  return status === "connected" ? "live" : "unknown";
}
