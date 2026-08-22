// イベントのカバー画像(Railway Bucket上のオブジェクトキー)の命名規則。
//
// キーは常に "events/<eventId>/cover-<timestamp>.<ext>" の形にする。
// アップロード確定APIはここで検証したキーしかDBへ書かない(他イベント/他人のキーを
// 書かせないための所有者検証)。

const COVER_KEY_PATTERN = /^events\/([a-z0-9]+)\/cover-\d+\.(jpe?g|png|webp)$/;

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const ALLOWED_COVER_CONTENT_TYPES = Object.keys(CONTENT_TYPE_EXTENSIONS);
export const MAX_COVER_IMAGE_BYTES = 5 * 1024 * 1024;

/** キーが指定イベント自身の命名規則に完全一致するか(prefix一致ではなく完全一致)。 */
export function isValidCoverKey(key: string, eventId: string): boolean {
  const match = COVER_KEY_PATTERN.exec(key);
  return match !== null && match[1] === eventId;
}

/** 新規アップロード用のキーを組み立てる。未対応の Content-Type は null。 */
export function buildCoverKey(eventId: string, contentType: string): string | null {
  const ext = CONTENT_TYPE_EXTENSIONS[contentType];
  if (!ext) return null;
  return `events/${eventId}/cover-${Date.now()}.${ext}`;
}
