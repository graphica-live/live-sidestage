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
