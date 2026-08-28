// TikTokアバターキャッシュ(Railway Bucket上のオブジェクトキー)の命名規則。
//
// 保存前に必ずWebPへ圧縮するので、拡張子は常にwebp固定。
// subjectId(anchorId または uniqueId)は外部由来の文字列なので、キーに埋め込む前に
// 許可文字だけに絞る(パストラバーサル・意図しないキー衝突を防ぐ)。

const SUBJECT_ID_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

export type AvatarKind = "battle_host" | "gift_sender";

const KIND_PREFIX: Record<AvatarKind, string> = {
  battle_host: "avatars/battle-host",
  gift_sender: "avatars/gift-sender",
};

/** subjectIdがキーに埋め込んでよい形か。外れる場合は呼び出し側でキャッシュ自体をスキップする。 */
export function isValidAvatarSubjectId(subjectId: string): boolean {
  return SUBJECT_ID_PATTERN.test(subjectId);
}

/** 保存先のオブジェクトキーを組み立てる。subjectIdが不正な形式ならnull。 */
export function buildAvatarKey(kind: AvatarKind, subjectId: string): string | null {
  if (!isValidAvatarSubjectId(subjectId)) return null;
  return `${KIND_PREFIX[kind]}/${subjectId}.webp`;
}
