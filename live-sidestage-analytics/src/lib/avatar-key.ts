// TikTokアバターキャッシュ(Railway Bucket上のオブジェクトキー)の命名規則。
//
// 保存前に必ずWebPへ圧縮するので、拡張子は常にwebp固定。
// **kind は持たない。** 2026-09の識別子統一で主体が tiktokUid(不変の数値ID)1種類になり、
// ホスト・ギフト送信者・イベント参加者のどれで現れても1行・1オブジェクトになった。
// 数値以外を弾くのでパストラバーサル・キー衝突も構造的に起きない。

const TIKTOK_UID_PATTERN = /^\d{1,32}$/;

const KEY_PREFIX = "avatars/tiktok-user";

/** tiktokUidがキーに埋め込んでよい形か。外れる場合は呼び出し側でキャッシュ自体をスキップする。 */
export function isValidAvatarSubjectId(tiktokUid: string): boolean {
  return TIKTOK_UID_PATTERN.test(tiktokUid);
}

/** 保存先のオブジェクトキーを組み立てる。tiktokUidが不正な形式ならnull。 */
export function buildAvatarKey(tiktokUid: string): string | null {
  if (!isValidAvatarSubjectId(tiktokUid)) return null;
  return `${KEY_PREFIX}/${tiktokUid}.webp`;
}
