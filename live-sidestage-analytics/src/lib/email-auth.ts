/// メール+パスワード認証(モバイル)の入力検証と正規化。
/// register/login の両ルートで共通に使う。

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321の実務上限

export const MIN_PASSWORD_LENGTH = 8;
// bcryptjsは72byteを超える入力を静かに切り詰める。マルチバイト文字だと文字数より
// バイト数の方が先に上限へ達するため、バイト長で切る。
export const MAX_PASSWORD_BYTES = 72;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_PATTERN.test(trimmed) ? trimmed : null;
}

export function readPassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < 1) return null;
  if (Buffer.byteLength(value, "utf8") > MAX_PASSWORD_BYTES) return null;
  return value;
}
