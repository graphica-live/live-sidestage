import { createPublicKey, type KeyObject } from "crypto";
import jwt from "jsonwebtoken";

/// Sign in with Apple のサーバー側処理。
///
/// **認証の実体は authorization code の交換であって id_token 単体の検証ではない。**
/// Android は Custom Tab で web フローを回すので、端末が受け取った応答は
/// exported Activity 経由で第三者が差し込めてしまう。code は単回・短命で、
/// Apple の token エンドポイントが client_secret と突き合わせて初めて有効になるため、
/// 「攻撃者が自分の Apple 応答を被害者の端末へ流し込んでログインさせる」経路を塞げる。
/// 加えて端末が生成した nonce が id_token に載って戻ることを完全一致で確認する
/// （呼び出し側の責務。[verifyAppleIdToken] は nonce をクレームとして返すだけ）。

export const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = `${APPLE_ISSUER}/auth/keys`;
const APPLE_TOKEN_URL = `${APPLE_ISSUER}/auth/token`;

const JWKS_TTL_MS = 60 * 60 * 1000;
/// 未知の kid を投げつけられても Apple を叩き続けないためのレート制限。
const JWKS_REFRESH_INTERVAL_MS = 60 * 1000;
/// Apple 側の障害中にキャッシュを使い続けてよい上限。これを超えたら
/// 「鍵が古すぎる」として上流障害を返す（失効した鍵で通し続けないため）。
const JWKS_MAX_STALE_MS = 24 * 60 * 60 * 1000;
const JWKS_TIMEOUT_MS = 10_000;
const JWKS_MAX_KEYS = 20;
const TOKEN_TIMEOUT_MS = 10_000;

/// client_secret の寿命。Apple の上限は6ヶ月だが、毎回作り直すので短くてよい。
const CLIENT_SECRET_TTL_SEC = 5 * 60;

export type AppleClientKind = "android" | "ios";

export interface AppleConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
  /// Android / web フローの client_id。Apple Developer Portal の Services ID。
  servicesId: string;
  /// Apple に登録した Return URL。code 交換時に完全一致で送る必要がある。
  redirectUri: string;
  /// 将来の iOS ネイティブ用。ネイティブの id_token は aud が Bundle ID になる。
  bundleId: string | null;
}

export class AppleAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AppleAuthError";
  }
}

/// 設定が揃っていなければ null。ルート側は 503 を返して fail closed にする。
/// Apple Developer Program の設定前にボタンを押されても、中途半端な状態で
/// ユーザーやアカウントを作らないための入口。
export function appleConfig(): AppleConfig | null {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const keyId = process.env.APPLE_KEY_ID?.trim();
  // Railway の環境変数は改行をそのまま入れづらいので \n エスケープも受ける。
  const privateKey = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const servicesId = process.env.APPLE_SERVICES_ID?.trim();
  const redirectUri = process.env.APPLE_REDIRECT_URI?.trim();
  const bundleId = process.env.APPLE_BUNDLE_ID?.trim();

  if (!teamId || !keyId || !privateKey || !servicesId || !redirectUri) return null;

  return { teamId, keyId, privateKey, servicesId, redirectUri, bundleId: bundleId || null };
}

/// Apple の id_token から取り出す値。
///
/// `email_verified` と `is_private_email` は **String("true"/"false") でも Boolean でも
/// 飛んでくる**（Apple の実装差）。素の truthiness で見ると文字列 "false" が true に
/// なるので、必ず [isTrueClaim] を通す。
export interface AppleIdTokenClaims {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  /// 「メールを非公開」で発行された privaterelay.appleid.com のアドレスか。
  /// **実メールが渡される場合、このクレーム自体が欠落することがある**。
  isPrivateEmail: boolean;
  nonce: string | null;
}

export function isTrueClaim(value: unknown): boolean {
  return value === true || value === "true";
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

/// Apple が初回認可でだけ返す氏名。署名対象ではない端末由来の値なので、
/// 制御文字を落として長さを切ってから保存する。
export function sanitizeName(...parts: unknown[]): string | null {
  const name = parts
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.replace(/[\p{Cc}\p{Cf}]/gu, "").trim())
    .filter((part) => part.length > 0)
    .join(" ");
  if (!name) return null;
  return name.slice(0, 64);
}

// ---------------------------------------------------------------------------
// client_secret
// ---------------------------------------------------------------------------

/// Apple の client_secret は「Team が署名した ES256 JWT」。
/// aud は常に Apple、sub は使う client_id（Services ID か Bundle ID）。
export function buildClientSecret(config: AppleConfig, clientId: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: config.teamId,
      iat: now,
      exp: now + CLIENT_SECRET_TTL_SEC,
      aud: APPLE_ISSUER,
      sub: clientId,
    },
    config.privateKey,
    { algorithm: "ES256", keyid: config.keyId },
  );
}

/// client_id と redirect_uri はクライアント種別で変わる。
/// **iOS ネイティブでは redirect_uri を送ってはいけない**（Apple が invalid_grant を返す）。
function resolveClient(
  config: AppleConfig,
  kind: AppleClientKind,
): { clientId: string; redirectUri: string | null } {
  if (kind === "ios") {
    if (!config.bundleId) {
      throw new AppleAuthError("iOS向けのAppleサインインは未設定です", 503);
    }
    return { clientId: config.bundleId, redirectUri: null };
  }
  return { clientId: config.servicesId, redirectUri: config.redirectUri };
}

// ---------------------------------------------------------------------------
// authorization code の交換
// ---------------------------------------------------------------------------

/// code を Apple の token エンドポイントで交換し、id_token と**使った client_id** を得る。
/// code は単回・短命なので、ここを通ったことが「この認証は本物」の根拠になる。
///
/// client_id を返すのは、続く [verifyAppleIdToken] で `aud` をその1つに固定するため。
/// Services ID と Bundle ID の和集合で許してしまうと、片方のクライアント向けに
/// 発行されたトークンをもう片方の経路で通せる余地が残る。
export async function exchangeAuthorizationCode(
  config: AppleConfig,
  { code, clientKind }: { code: string; clientKind: AppleClientKind },
): Promise<{ idToken: string; clientId: string }> {
  const { clientId, redirectUri } = resolveClient(config, clientKind);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: buildClientSecret(config, clientId),
  });
  if (redirectUri) body.set("redirect_uri", redirectUri);

  let response: Response;
  try {
    response = await fetch(APPLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch {
    throw new AppleAuthError("Appleの認証サーバーへ接続できませんでした", 502);
  }

  const json = (await response.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;

  if (!response.ok) {
    // invalid_grant は「code が期限切れ・使用済み・別クライアント宛」。
    // **同じ code を送り直しても直らない**（単回使用）ので、端末には
    // 認証をやり直させる。ここで自動リトライしてはいけない。
    if (json?.error === "invalid_grant") {
      throw new AppleAuthError("Apple認証の有効期限が切れました。もう一度お試しください", 401);
    }
    // invalid_client は client_secret / Team ID / Key の設定不備。利用者が
    // やり直しても直らないので、未設定と同じ 503 にして設定側の問題だと分かるようにする。
    if (json?.error === "invalid_client") {
      throw new AppleAuthError("Appleサインインの設定に問題があります", 503);
    }
    throw new AppleAuthError("Appleの認証に失敗しました", 502);
  }

  if (typeof json?.id_token !== "string") {
    // タイムアウトや解析失敗と同じく、Apple 側では code が消費済みの可能性がある。
    // 自動で再交換しないこと。
    throw new AppleAuthError("Appleの応答にIDトークンが含まれていません", 502);
  }
  return { idToken: json.id_token, clientId };
}

// ---------------------------------------------------------------------------
// id_token の検証
// ---------------------------------------------------------------------------

let cachedKeys: Map<string, KeyObject> | null = null;
let cachedAt = 0;
let lastFetchAt = 0;
/// 同時に走った検証が JWKS を何本も取りに行かないよう、進行中の取得を共有する。
let inFlightFetch: Promise<Map<string, KeyObject>> | null = null;

/// テスト用。モジュールスコープのキャッシュを捨てる。
export function __resetAppleJwksCacheForTest(): void {
  cachedKeys = null;
  cachedAt = 0;
  lastFetchAt = 0;
  inFlightFetch = null;
}

async function fetchJwks(): Promise<Map<string, KeyObject>> {
  let response: Response;
  try {
    response = await fetch(APPLE_JWKS_URL, { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) });
  } catch {
    throw new AppleAuthError("Appleの公開鍵を取得できませんでした", 502);
  }
  if (!response.ok) {
    throw new AppleAuthError("Appleの公開鍵を取得できませんでした", 502);
  }

  const json = (await response.json().catch(() => null)) as { keys?: unknown } | null;
  const rawKeys = Array.isArray(json?.keys) ? json.keys.slice(0, JWKS_MAX_KEYS) : [];

  const keys = new Map<string, KeyObject>();
  for (const raw of rawKeys) {
    if (!raw || typeof raw !== "object") continue;
    const { kid, kty, n, e } = raw as Record<string, unknown>;
    if (typeof kid !== "string" || kty !== "RSA" || typeof n !== "string" || typeof e !== "string") {
      continue;
    }
    try {
      // Node 標準の JWK インポート。jose / jwks-rsa を足さずに済ませるため。
      // kid や alg を混ぜると弾かれることがあるので kty/n/e だけ渡す。
      keys.set(kid, createPublicKey({ key: { kty, n, e }, format: "jwk" }));
    } catch {
      // 壊れた鍵は無視する。他の鍵で検証できる可能性を残す。
    }
  }

  if (keys.size === 0) {
    throw new AppleAuthError("Appleの公開鍵を取得できませんでした", 502);
  }
  return keys;
}

function refreshJwks(): Promise<Map<string, KeyObject>> {
  if (inFlightFetch) return inFlightFetch;
  lastFetchAt = Date.now();
  inFlightFetch = fetchJwks()
    .then((keys) => {
      cachedKeys = keys;
      cachedAt = Date.now();
      return keys;
    })
    .finally(() => {
      inFlightFetch = null;
    });
  return inFlightFetch;
}

async function resolveSigningKey(kid: string): Promise<KeyObject> {
  const fresh = cachedKeys !== null && Date.now() - cachedAt < JWKS_TTL_MS;
  if (fresh) {
    const key = cachedKeys!.get(kid);
    if (key) return key;
  }

  const throttled = Date.now() - lastFetchAt < JWKS_REFRESH_INTERVAL_MS;
  if (!cachedKeys || !throttled) {
    try {
      const key = (await refreshJwks()).get(kid);
      if (key) return key;
    } catch (error) {
      // 取得に失敗しても期限切れのキャッシュがあれば使い続ける。
      // Apple 側の一時障害でログインを全滅させないため。
      if (!cachedKeys) throw error;
    }
  }

  // 期限切れのキャッシュで凌ぐのは、Apple 側の一時障害でログインを全滅させないため。
  // ただし無期限に使い続けると、失効した鍵の署名を通し続けることになる。
  if (cachedKeys && Date.now() - cachedAt >= JWKS_MAX_STALE_MS) {
    throw new AppleAuthError("Appleの公開鍵を取得できませんでした", 502);
  }

  const stale = cachedKeys?.get(kid);
  if (stale) return stale;
  throw new AppleAuthError("Apple認証トークンの署名鍵が見つかりません", 401);
}

/// Apple の id_token を検証してクレームを返す。
///
/// token エンドポイントから TLS で直接受け取った値だが、署名も含めて検証する
/// （aud を我々の client_id に固定できるのはここだけで、設定ミスを検知できる）。
///
/// [expectedAudience] には **code 交換で実際に使った client_id** を渡す。
export async function verifyAppleIdToken(
  idToken: string,
  expectedAudience: string,
): Promise<AppleIdTokenClaims> {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded === "string") {
    throw new AppleAuthError("Apple認証トークンを解析できませんでした", 401);
  }
  // alg 混同攻撃を防ぐ。jwt.verify にも algorithms を渡すが、鍵を引く前に弾く。
  if (decoded.header.alg !== "RS256" || typeof decoded.header.kid !== "string") {
    throw new AppleAuthError("Apple認証トークンの形式が不正です", 401);
  }

  const key = await resolveSigningKey(decoded.header.kid);

  let payload: jwt.JwtPayload;
  try {
    const verified = jwt.verify(idToken, key, {
      algorithms: ["RS256"],
      issuer: APPLE_ISSUER,
      // Android/web は Services ID、iOS ネイティブは Bundle ID が aud になる。
      // **和集合ではなく、この認証で実際に使った1つ**に固定する。
      audience: expectedAudience,
    });
    if (typeof verified === "string") throw new Error("unexpected payload");
    payload = verified;
  } catch {
    throw new AppleAuthError("Apple認証トークンの検証に失敗しました", 401);
  }

  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new AppleAuthError("Apple認証トークンにユーザー識別子がありません", 401);
  }

  return {
    sub: payload.sub,
    email: normalizeEmail(payload.email),
    emailVerified: isTrueClaim(payload.email_verified),
    isPrivateEmail: isTrueClaim(payload.is_private_email),
    nonce: typeof payload.nonce === "string" ? payload.nonce : null,
  };
}
