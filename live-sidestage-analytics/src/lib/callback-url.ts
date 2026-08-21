// ログイン後の戻り先(callbackUrl)を安全な同一オリジンの相対パスに正規化する。
//
// middleware(next-auth の withAuth)は `/login?callbackUrl=/events` のように
// 相対パスで付けてくるが、外部から絶対URLを差し込まれる経路もあるため、
// オープンリダイレクトにならない値だけを通す。弾いた場合は "/" へ落とす。
export const DEFAULT_CALLBACK_URL = "/";

export function safeCallbackUrl(raw: string | null | undefined, origin: string): string {
  if (!raw) return DEFAULT_CALLBACK_URL;

  let url: URL;
  let base: URL;
  try {
    base = new URL(origin);
    url = new URL(raw, base);
  } catch {
    return DEFAULT_CALLBACK_URL;
  }

  // 別オリジン(絶対URL・`//evil.example` のプロトコル相対)は捨てる。
  if (url.origin !== base.origin) return DEFAULT_CALLBACK_URL;

  // ログイン画面自身へ戻すとループするので既定へ。
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) {
    return DEFAULT_CALLBACK_URL;
  }

  const path = `${url.pathname}${url.search}${url.hash}`;

  // `/\evil.example` のようにパーサ差でオリジン判定をすり抜ける形を最後に落とす。
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    return DEFAULT_CALLBACK_URL;
  }

  return path;
}
