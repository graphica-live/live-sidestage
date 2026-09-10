// TikTok ID(Streamer.tiktokHandle)の再変更を7日間ロックする判定ロジック。
// ユーザー操作による変更(web /api/verify/generate, mobile PATCH /api/mobile/streamer)にのみ適用する。
// absorbRooms()による自動ID合流はユーザー操作ではないため対象外(tiktokHandleChangedAtを更新しない)。

export const TIKTOK_ID_CHANGE_LOCK_DAYS = 7;
const LOCK_MS = TIKTOK_ID_CHANGE_LOCK_DAYS * 24 * 60 * 60 * 1000;

export type TiktokHandleChangeCheck =
  | { ok: true }
  | { ok: false; retryAfter: Date };

/**
 * TikTok IDの変更を許可してよいか判定する。
 *
 * `currentTiktokHandle` / `nextTiktokHandle` は呼び出し側で必ず `normalizeTiktokId()` 済みの値を渡すこと
 * (大文字小文字・trim・先頭@の不一致による誤ロック/ロック漏れを防ぐため)。
 *
 * 正規化後の値が変わらない場合(冪等リトライ)は常に許可する。
 */
export function checkTiktokHandleChangeAllowed(
  current: { normalizedTiktokHandle: string; tiktokHandleChangedAt: Date | null },
  nextNormalizedTiktokHandle: string,
  now: Date = new Date()
): TiktokHandleChangeCheck {
  if (current.normalizedTiktokHandle === nextNormalizedTiktokHandle) {
    return { ok: true };
  }
  if (!current.tiktokHandleChangedAt) {
    return { ok: true };
  }
  const retryAfter = new Date(current.tiktokHandleChangedAt.getTime() + LOCK_MS);
  if (now.getTime() >= retryAfter.getTime()) {
    return { ok: true };
  }
  return { ok: false, retryAfter };
}

/**
 * ハンドル変更は「同一TikTokアカウントの改名」に限る。実在確認で得た tiktokUid が
 * 登録済みの `Streamer.tiktokUid` と異なる場合は別アカウントへの付け替えなので拒否する。
 *
 * 通すと所有の根拠(tiktokUid)と接続先(tiktokHandle)が別人を指し、接続直前のUID照合で
 * 監視が止まるか、既存のギフト・履歴が別アカウントの配信に帰属する。
 */
export function formatTiktokUidMismatchError() {
  return {
    error:
      "別のTikTokアカウントへの変更はできません。同じアカウントのID変更のみ可能です(TIKTOK_UID_MISMATCH)",
    code: "TIKTOK_UID_MISMATCH" as const,
  };
}

/**
 * UID mismatchチェック（別アカウントへの付け替え拒否）の一時無効化フラグ。
 * 2026-09-11: 運用都合で一時的にOFF。別アカウントへの付け替え拒否という仕様自体を
 * 恒久廃止したわけではなく、将来 TIKTOK_UID_MISMATCH_CHECK_DISABLED="0" を設定して
 * ONに戻す可能性がある。
 *
 * 既存の TIKTOK_EXISTENCE_CHECK_DISABLED (tiktok-existence.ts) とは極性が逆で、
 * こちらは未設定(デフォルト)が「無効化」を意味する点に注意。
 */
export function isTiktokUidMismatchCheckDisabled(): boolean {
  return process.env.TIKTOK_UID_MISMATCH_CHECK_DISABLED !== "0";
}

export type TiktokUidMatchCheck = { ok: true } | { ok: false };

/**
 * ハンドル変更が「同一TikTokアカウントの改名」であることの確認を行うべきか判定する。
 * 優先順位: exempt(ADMIN_EMAIL等、7日ロックも免除される特例ユーザー) を最優先で許可し、
 * 次に isTiktokUidMismatchCheckDisabled() が true の間は常に許可する(一時無効化)。
 * どちらでもない場合のみ tiktokUid の一致を確認する。
 */
export function checkTiktokUidMatch(
  current: { tiktokUid: string },
  nextTiktokUid: string,
  opts: { exempt: boolean }
): TiktokUidMatchCheck {
  if (opts.exempt) return { ok: true };
  if (isTiktokUidMismatchCheckDisabled()) return { ok: true };
  if (current.tiktokUid !== nextTiktokUid) return { ok: false };
  return { ok: true };
}

export function formatTiktokHandleLockError(retryAfter: Date, now: Date = new Date()) {
  const remainingDays = Math.max(
    1,
    Math.ceil((retryAfter.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
  );
  return {
    error: `TikTok IDの変更は前回の変更から${TIKTOK_ID_CHANGE_LOCK_DAYS}日間できません(あと${remainingDays}日)`,
    code: "TIKTOK_ID_CHANGE_LOCKED" as const,
    retryAfter: retryAfter.toISOString(),
  };
}
