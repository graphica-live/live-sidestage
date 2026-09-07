// TikTok ID(Streamer.tiktokId)の再変更を7日間ロックする判定ロジック。
// ユーザー操作による変更(web /api/verify/generate, mobile PATCH /api/mobile/streamer)にのみ適用する。
// absorbRooms()による自動ID合流はユーザー操作ではないため対象外(tiktokIdChangedAtを更新しない)。

export const TIKTOK_ID_CHANGE_LOCK_DAYS = 7;
const LOCK_MS = TIKTOK_ID_CHANGE_LOCK_DAYS * 24 * 60 * 60 * 1000;

export type TiktokIdChangeCheck =
  | { ok: true }
  | { ok: false; retryAfter: Date };

/**
 * TikTok IDの変更を許可してよいか判定する。
 *
 * `currentTiktokId` / `nextTiktokId` は呼び出し側で必ず `normalizeTiktokId()` 済みの値を渡すこと
 * (大文字小文字・trim・先頭@の不一致による誤ロック/ロック漏れを防ぐため)。
 *
 * 正規化後の値が変わらない場合(冪等リトライ)は常に許可する。
 */
export function checkTiktokIdChangeAllowed(
  current: { normalizedTiktokId: string; tiktokIdChangedAt: Date | null },
  nextNormalizedTiktokId: string,
  now: Date = new Date()
): TiktokIdChangeCheck {
  if (current.normalizedTiktokId === nextNormalizedTiktokId) {
    return { ok: true };
  }
  if (!current.tiktokIdChangedAt) {
    return { ok: true };
  }
  const retryAfter = new Date(current.tiktokIdChangedAt.getTime() + LOCK_MS);
  if (now.getTime() >= retryAfter.getTime()) {
    return { ok: true };
  }
  return { ok: false, retryAfter };
}

export function formatTiktokIdLockError(retryAfter: Date, now: Date = new Date()) {
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
