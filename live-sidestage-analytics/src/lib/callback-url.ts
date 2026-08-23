// ログイン後の戻り先(callbackUrl)を安全な同一オリジンの相対パスに正規化する。
//
// middleware(next-auth の withAuth)は `/login?callbackUrl=/events` のように
// 相対パスで付けてくるが、外部から絶対URLを差し込まれる経路もあるため、
// オープンリダイレクトにならない値だけを通す。弾いた場合は fallback へ落とす。
export const DEFAULT_CALLBACK_URL = "/";

// ログイン画面自身へ戻すとループするので、既知のログイン導線は全部弾く。
// analytics / event / 事務所で画面が分かれているため1本では足りない。
const LOGIN_PATHS = ["/login", "/event/login", "/agency/login"];

function isLoginPath(pathname: string): boolean {
  return LOGIN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * @param fallback 弾いたときの戻り先。イベント側のログインは "/events" を渡して
 *   analytics のトップ("/" → /analytics か /setup)へ流れないようにする。
 *   **拒否する枝すべてがこれを返すこと。** 1つでも DEFAULT_CALLBACK_URL のまま
 *   残すと、その入力のときだけ別サービス側へ着地する。
 */
export function safeCallbackUrl(
  raw: string | null | undefined,
  origin: string,
  fallback: string = DEFAULT_CALLBACK_URL
): string {
  if (!raw) return fallback;

  let url: URL;
  let base: URL;
  try {
    base = new URL(origin);
    url = new URL(raw, base);
  } catch {
    return fallback;
  }

  // 別オリジン(絶対URL・`//evil.example` のプロトコル相対)は捨てる。
  if (url.origin !== base.origin) return fallback;

  if (isLoginPath(url.pathname)) return fallback;

  const path = `${url.pathname}${url.search}${url.hash}`;

  // `/\evil.example` のようにパーサ差でオリジン判定をすり抜ける形を最後に落とす。
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    return fallback;
  }

  return path;
}

/**
 * 戻り先を特定のサブツリーへ閉じ込める。イベント側のログインが
 * `?callbackUrl=/analytics` で analytics へ着地するのを防ぐ。
 *
 * 前置一致ではなくパス境界で判定すること(`/events` の指定で `/eventsomething` を
 * 通さない)。事務所ログインの既存実装は境界なしの startsWith で同じバグを持つ。
 */
export function clampCallbackUrl(path: string, prefix: string, fallback: string): string {
  const pathname = path.split(/[?#]/)[0];
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return path;
  return fallback;
}
