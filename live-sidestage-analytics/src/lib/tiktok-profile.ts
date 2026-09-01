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

/**
 * `data.user` が無く「そのハンドルのユーザーがいない」ことを TikTok が明示するときの `statusCode`。
 *
 * 実測(2026-08-24、このエンドポイントを直接叩いて確認):
 *
 * | ハンドル | statusCode | message | data |
 * | --- | --- | --- | --- |
 * | `tiktok`(実在) | `0` | `""` | `user` あり |
 * | `zzq_notexist_9c8f7e6d5a4b3` | `19881007` | `"user_not_found"` | `null` |
 *
 * **「いない」には専用のコードがある**ことが重要で、レート制限・bot 判定・地域ブロックは
 * これとは別の値になる。したがって「実在しないから登録を拒否する」判断は、非 0 全部ではなく
 * **このコードだけ**を根拠にする(`classifyAccountExistence`)。
 */
export const USER_NOT_FOUND_STATUS_CODE = 19881007;

/** `message` 側の同じシグナル。statusCode が変わってもこちらで拾えるようにしておく。 */
const USER_NOT_FOUND_MESSAGE = "user_not_found";

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

/**
 * `<img src>` に出す URL なので、TikTok の画像 CDN に限定する。
 * ギフトのアイコン(`gift/list/` の `image.url_list`、`chat:gift` の `giftPictureUrl`)も
 * 同じ CDN 群なので、この allowlist を共用する。
 */
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
 * 自前ストレージ(Railway Bucket、`src/lib/media-bucket.ts`)が発行した presigned URL かどうか。
 *
 * `resolveAvatarUrls`(`avatar-storage.ts`)がキャッシュ済みアバターに対して返す URL は
 * TikTok CDN ではなく Bucket のホストになるため、`isAllowedAvatarUrl` の allowlist には
 * 一致しない。ホストの suffix 一致だと bucket 名部分を検証できないため、
 * `MEDIA_BUCKET_ENDPOINT` + `MEDIA_BUCKET_NAME` から期待ホストを組み立てて完全一致で見る
 * (`media-bucket.ts` の通り virtual-host style: `<bucket>.<host>`)。
 */
function isAllowedMediaBucketUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_AVATAR_URL_LENGTH) return false;

  const endpoint = process.env.MEDIA_BUCKET_ENDPOINT;
  const bucket = process.env.MEDIA_BUCKET_NAME;
  if (!endpoint || !bucket) return false;

  let endpointHost: string;
  try {
    endpointHost = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return false;
  }
  const expectedHost = `${bucket}.${endpointHost}`;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  return url.hostname.toLowerCase() === expectedHost;
}

// isAllowedAvatarUrl / isAllowedMediaBucketUrl を通らない値は null に落とす。DB格納時点で
// 検証済みとは限らない値(Gift.profileImageUrl/giftPictureUrl等)を外部(モバイルクライアント)
// へ返す前に使う。自前ストレージ(Railway Bucket)のキャッシュ済み URL も対象に含める。
export function sanitizeAvatarUrl(value: string | null): string | null {
  if (isAllowedAvatarUrl(value)) return value;
  if (isAllowedMediaBucketUrl(value)) return value;
  return null;
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
 * `api-live/user/room/` を1回叩いて、本体か失敗理由かを返す。
 *
 * プロフィール取得(`fetchTiktokProfile`)と実在確認(`checkAccountExistence`)で
 * ヘッダ・リダイレクト方針・タイムアウトの扱いを揃えるために切り出してある。
 * **例外は投げない。**
 */
type UserRoomResponse =
  | { kind: "json"; body: unknown }
  | { kind: "rate-limited" }
  | { kind: "error" };

async function requestUserRoom(tiktokId: string, timeoutMs: number): Promise<UserRoomResponse> {
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
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // タイムアウト・ネットワークエラー・リダイレクト。
    return { kind: "error" };
  }

  if (response.status === 429) return { kind: "rate-limited" };
  if (!response.ok) return { kind: "error" };

  try {
    return { kind: "json", body: await response.json() };
  } catch {
    return { kind: "error" };
  }
}

/**
 * アカウントが実在するか。**アイコンが取れるかとは独立に判定する。**
 *
 * - `EXISTS` … TikTok が `data.user` を返した
 * - `MISSING` … TikTok が「そのユーザーはいない」と明示した(`USER_NOT_FOUND_STATUS_CODE`)
 * - `UNVERIFIED` … 判定できなかった(レート制限・障害・想定外の形・別人のレスポンス)
 */
export type AccountExistence = "EXISTS" | "MISSING" | "UNVERIFIED";

/** 実在確認と同じ応答から取れた結果。 */
export type AccountExistenceCheck = {
  verdict: AccountExistence;
  /**
   * 実在確認(`EXISTS`)と同じ応答から取れたニックネーム。取れなければ null
   * (取得失敗ではなく付随情報なので、判定不能とは扱わない)。
   */
  nickname: string | null;
};

/**
 * `EXISTS` と判定された応答から nickname だけを取り出す。
 *
 * **`parseProfileResponse` を経由しない。** あちらは avatar URL の allowlist 検証に落ちると
 * nickname ごと null を返す(TikTok が画像 CDN のホストを変えると起きる、5.5 と同じ結合の罠)。
 * ここは呼び出し側で既に `classifyAccountExistence` が `data.user` の存在と uniqueId 照合を
 * 済ませている前提で、avatar 抜きに nickname だけ読む。
 */
export function extractVerifiedNickname(body: unknown, expectedUniqueId: string): string | null {
  if (typeof body !== "object" || body === null) return null;
  const root = body as { statusCode?: unknown; data?: unknown };
  if (root.statusCode !== 0) return null;

  const user = readUser(root.data);
  if (user === null) return null;

  const uniqueId = (user as { uniqueId?: unknown }).uniqueId;
  if (typeof uniqueId === "string" && uniqueId.toLowerCase() !== expectedUniqueId.toLowerCase()) {
    return null;
  }

  const nickname = (user as { nickname?: unknown }).nickname;
  return typeof nickname === "string" && nickname.trim().length > 0 ? nickname.trim() : null;
}

/**
 * レスポンス本体から実在を判定する。純粋関数。
 *
 * **非 0 の `statusCode` をまとめて「いない」にしない。** レート制限や bot 判定で
 * 実在アカウントが一斉に弾かれると、イベントの参加者登録がまるごと止まる。
 * 拒否の根拠にしてよいのは TikTok が明示した `user_not_found` だけで、
 * それ以外は**判定不能**として扱う(呼び出し側が通す)。
 *
 * `expectedUniqueId` が一致しないレスポンスも「別人を掴んでいる」ので判定不能にする
 * (`parseProfileResponse` と同じく、`uniqueId` がそもそも入っていなければ照合しない)。
 */
export function classifyAccountExistence(
  body: unknown,
  expectedUniqueId: string
): AccountExistence {
  if (typeof body !== "object" || body === null) return "UNVERIFIED";

  const root = body as { statusCode?: unknown; message?: unknown; data?: unknown };
  const user = readUser(root.data);

  // 成功応答。**ここでは絶対に MISSING を返さない** — `message` が矛盾していても
  // 拒否側へ倒さない(判定の優先順位を決めておかないと、矛盾した応答で実在アカウントを弾く)。
  if (root.statusCode === 0) {
    if (user === null) return "UNVERIFIED";

    const uniqueId = (user as { uniqueId?: unknown }).uniqueId;
    if (typeof uniqueId === "string" && uniqueId.toLowerCase() !== expectedUniqueId.toLowerCase()) {
      return "UNVERIFIED";
    }
    return "EXISTS";
  }

  // 非 0。「そのユーザーはいない」と明示されたときだけ拒否する。
  const saysNotFound =
    root.statusCode === USER_NOT_FOUND_STATUS_CODE ||
    (typeof root.message === "string" && root.message === USER_NOT_FOUND_MESSAGE);
  if (!saysNotFound) return "UNVERIFIED";

  // 「いない」と言いながら user を返すのは矛盾している。ここも拒否側へ倒さない。
  if (user !== null) return "UNVERIFIED";

  return "MISSING";
}

/** `data.user` をオブジェクトとして取り出す。取れなければ null。 */
function readUser(data: unknown): object | null {
  if (typeof data !== "object" || data === null) return null;
  const user = (data as { user?: unknown }).user;
  if (typeof user !== "object" || user === null) return null;
  return user;
}

/**
 * アカウントの実在を確認する。**失敗しても例外を投げない。**
 *
 * 実在(`EXISTS`)が確認できたときは、同じ応答から nickname も一緒に返す
 * (参加者登録の表示名フォールバックに使う。登録経路からの新規の問い合わせは増やさない)。
 *
 * 呼び出しの間引き(キャッシュ・同時実行上限・サーキットブレーカ)は
 * `src/lib/tiktok-existence.ts` が持つ。ここは1回の問い合わせと判定だけ。
 */
export async function checkAccountExistence(
  tiktokId: string,
  options: { timeoutMs?: number } = {}
): Promise<AccountExistenceCheck> {
  const response = await requestUserRoom(tiktokId, options.timeoutMs ?? TIMEOUT_MS);
  if (response.kind !== "json") return { verdict: "UNVERIFIED", nickname: null };

  const verdict = classifyAccountExistence(response.body, tiktokId);
  const nickname = verdict === "EXISTS" ? extractVerifiedNickname(response.body, tiktokId) : null;
  return { verdict, nickname };
}

/**
 * 配信者のプロフィールを引く。**失敗しても例外を投げない。**
 *
 * 呼び出し元にとってアイコンは付随情報でしかなく、TikTok 側の仕様変更やレート制限で
 * 本来の処理を止めてはならない。
 */
export async function fetchTiktokProfile(tiktokId: string): Promise<TiktokProfileResult> {
  const response = await requestUserRoom(tiktokId, TIMEOUT_MS);
  if (response.kind === "rate-limited") return { ok: false, reason: "RATE_LIMITED" };
  if (response.kind === "error") return { ok: false, reason: "ERROR" };

  const body = response.body;
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
