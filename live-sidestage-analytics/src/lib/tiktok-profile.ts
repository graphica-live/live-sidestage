// TikTok の配信者プロフィール(アイコン・表示名)を取得する。
//
// 使うのは `api-live/user/room/`。tiktok-live-connector の FetchRoomInfoFromApiLiveRoute と
// 同じエンドポイントで、**署名(EulerStream)も Cookie も要らず、配信していなくても返る**
// (`data.user.status` がオフラインでも avatar は入っている)。
//
// プロフィールページ(`https://www.tiktok.com/@<id>`)の HTML から取る方法は使わない —
// JS チャレンジのページが返るだけで avatar が含まれない。`fetchRoomInfo()`(webcast の
// room/info/) も使わない — 配信中しか取れず、署名の枠を消費する。
//
// **返ってくる avatar の URL は署名付きで、`x-expires` はおよそ47時間後。**
// 永続化すると必ず腐るので、DB へ保存せずキャッシュとして扱う(src/lib/tiktok-avatar.ts)。
//
// 同じレスポンスの `data.user.id` は TikTok の数値 userId で、こちらは**不変**なので
// TiktokRoom.hostUserId へ保存する(src/lib/tiktok-host-id.ts)。avatar URL とは扱いが逆になる。

/** 取得できたプロフィール。avatarUrl は検証済みの https URL。 */
export type TiktokProfile = {
  avatarUrl: string;
  nickname: string | null;
  /**
   * TikTok の数値 userId(`data.user.id`)。バトル payload の `anchorIdStr` と同じ空間で、
   * `tiktok_battles.hostScores` のキーと突き合わせるのに使う。**不変**なので保存してよい。
   *
   * **avatar が取れないと null ではなくプロフィール全体が取れない**(parseProfileResponse は
   * avatar URL の検証に落ちると null を返す)。TikTok が画像 CDN のホストを変えると
   * アイコンとこの id が同時に取れなくなるが、avatarUrl を nullable にすると
   * tiktok-avatar.ts まで波及するため、この結合は意図的に受け入れている。
   */
  userId: string | null;
};

/** 数値 userId として保存してよい形か。 */
const USER_ID_PATTERN = /^\d{1,32}$/;

/**
 * `data.user.id` を保存できる形へ寄せる。取れなければ null(付随情報なので取得失敗にはしない)。
 *
 * 実測(2026-08)では `"id":"5831967"` のように**クォートされた JSON 文字列**で返るため、
 * 19桁の新しい userId でも `JSON.parse` の精度落ちは起きない。ただし将来クォートが外れると
 * 16桁以上は Number.MAX_SAFE_INTEGER を超えて**既に壊れた値**になっているので、
 * 誤った id を保存するより捨てる。
 */
export function parseUserId(value: unknown): string | null {
  if (typeof value === "string") {
    return USER_ID_PATTERN.test(value) ? value : null;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return String(value);
  }
  return null;
}

/**
 * 取得結果。**失敗の理由で扱いを変えたいので null では返さない。**
 *
 * - `NOT_FOUND` … そのハンドルのユーザーがいない。当分変わらないので長くキャッシュしてよい
 * - `RATE_LIMITED` … TikTok に絞られている。間隔を空けて再試行する
 * - `ERROR` … タイムアウト・ネットワーク・想定外のレスポンス。短めに再試行する
 */
export type TiktokProfileResult =
  | { ok: true; profile: TiktokProfile }
  | { ok: false; reason: "NOT_FOUND" | "RATE_LIMITED" | "ERROR" };

const ENDPOINT = "https://www.tiktok.com/api-live/user/room/";

const TIMEOUT_MS = 10_000;

/** `<img src>` に出す URL なので、TikTok の画像 CDN に限定する。 */
const ALLOWED_AVATAR_HOSTS = [
  ".tiktokcdn.com",
  ".tiktokcdn-us.com",
  ".ibyteimg.com",
  ".byteimg.com",
];

const MAX_AVATAR_URL_LENGTH = 1000;

/**
 * 画像 URL として使ってよいか。
 *
 * 外部レスポンス由来の文字列をブラウザへ渡すため、スキームとホストを固定する。
 * `javascript:` / `data:` / 見知らぬホストを弾くのが目的。
 *
 * ホストの照合は先頭ドット付きの接尾辞で行うので、ラベル境界が自動的に守られる
 * (`tiktokcdn.com.evil.example` も `eviltiktokcdn.com` も通らない)。
 */
export function isAllowedAvatarUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_AVATAR_URL_LENGTH) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  return ALLOWED_AVATAR_HOSTS.some((suffix) => host.endsWith(suffix));
}

/**
 * `api-live/user/room/` のレスポンスから使える値だけを取り出す。
 *
 * 解像度の高いものから順に見て、検証を通った最初の URL を採る。
 * どれも通らなければ null(呼び出し側は「取れなかった」として扱う)。
 *
 * `expectedUniqueId` を渡すと、レスポンスの `data.user.uniqueId` と突き合わせて
 * 別人のアイコンを掴まないようにする。**uniqueId が入っていない場合は照合しない** —
 * 実測(2026-08)では必ず入っているが、無くなったときに全員のアイコンが消えるより、
 * 照合を諦めるほうが被害が小さい。
 */
export function parseProfileResponse(
  body: unknown,
  expectedUniqueId?: string
): TiktokProfile | null {
  if (typeof body !== "object" || body === null) return null;

  const root = body as { statusCode?: unknown; data?: unknown };
  // statusCode は成功時 0。エラー時は数値が入る(存在しないユーザーなど)。
  if (root.statusCode !== undefined && root.statusCode !== 0) return null;

  const data = root.data;
  if (typeof data !== "object" || data === null) return null;

  const user = (data as { user?: unknown }).user;
  if (typeof user !== "object" || user === null) return null;

  const u = user as {
    avatarLarger?: unknown;
    avatarMedium?: unknown;
    avatarThumb?: unknown;
    nickname?: unknown;
    uniqueId?: unknown;
    id?: unknown;
  };

  if (
    expectedUniqueId !== undefined &&
    typeof u.uniqueId === "string" &&
    u.uniqueId.toLowerCase() !== expectedUniqueId.toLowerCase()
  ) {
    return null;
  }

  const avatarUrl = [u.avatarLarger, u.avatarMedium, u.avatarThumb].find(isAllowedAvatarUrl);
  if (!avatarUrl) return null;

  const nickname =
    typeof u.nickname === "string" && u.nickname.trim().length > 0 ? u.nickname.trim() : null;

  return { avatarUrl, nickname, userId: parseUserId(u.id) };
}

/**
 * 配信者のプロフィールを引く。**失敗しても例外を投げない。**
 *
 * 呼び出し元にとってアイコンは付随情報でしかなく、TikTok 側の仕様変更やレート制限で
 * 本来の処理を止めてはならない。
 */
export async function fetchTiktokProfile(tiktokId: string): Promise<TiktokProfileResult> {
  const url = `${ENDPOINT}?aid=1988&sourceType=54&uniqueId=${encodeURIComponent(tiktokId)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
        Referer: `https://www.tiktok.com/@${encodeURIComponent(tiktokId)}/live`,
      },
      // 想定外のリダイレクト(ログイン画面・地域ブロック)を追いかけない。
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // タイムアウト・ネットワークエラー・リダイレクト。
    return { ok: false, reason: "ERROR" };
  }

  if (response.status === 429) return { ok: false, reason: "RATE_LIMITED" };
  if (!response.ok) return { ok: false, reason: "ERROR" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "ERROR" };
  }

  const profile = parseProfileResponse(body, tiktokId);
  if (profile) return { ok: true, profile };

  // statusCode がエラーなら「そのユーザーがいない」とみなす。avatar だけ取れないケースも
  // 同じ扱いでよい(どちらも再試行しても当分変わらない)。
  const statusCode = (body as { statusCode?: unknown } | null)?.statusCode;
  if (typeof statusCode === "number" && statusCode !== 0) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  return { ok: false, reason: "ERROR" };
}
