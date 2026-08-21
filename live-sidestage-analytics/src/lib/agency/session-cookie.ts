// 事務所セッションの識別子まわりだけを持つ、依存ゼロのモジュール。
//
// middleware は Edge ランタイムで動くため Prisma を読み込めず、
// クライアントコンポーネントに import するとサーバー専用コードがバンドルへ混ざる。
// そのため Cookie 名とパスの定数は agency/auth.ts(NextAuth設定)から切り離して
// ここに置き、middleware・クライアント・サーバーのどこからでも安全に参照できるようにする。

export const AGENCY_AUTH_BASE_PATH = "/api/agency-auth";
export const AGENCY_LOGIN_PATH = "/agency/login";
export const AGENCY_CONSOLE_PATH = "/agency";

// 事務所用 Google プロバイダの id。配信者側の "google" とは別 id にする。
//
// NextAuth v4 は OAuth の redirect_uri を必ず `<origin>/api/auth/callback/<providerId>`
// として組み立てる(utils/parse-url.js が、パスを持たない NEXTAUTH_URL に対して "/api/auth" を
// 既定パスとして補うため)。事務所側を /api/agency-auth にマウントしても、この一点だけは
// /api/auth に戻ってくる。id を分けておけば URL が
// /api/auth/callback/agency-google となり、配信者側の /api/auth/callback/google と衝突せず、
// /api/auth のルートから事務所インスタンスへ振り分けられる。
//
// Google Cloud Console の「承認済みのリダイレクト URI」にも
// <origin>/api/auth/callback/agency-google を登録する必要がある。
export const AGENCY_GOOGLE_PROVIDER_ID = "agency-google";

// 本番(https)では NextAuth と同じ規約で __Secure- を付ける。
export const AGENCY_USE_SECURE_COOKIES = (process.env.NEXTAUTH_URL ?? "").startsWith("https://");

const prefix = AGENCY_USE_SECURE_COOKIES ? "__Secure-" : "";

// 配信者/管理者側の next-auth.session-token とは別名にすることで、
// 同じブラウザで両方のセッションが同時に成立する。
export const AGENCY_SESSION_COOKIE = `${prefix}agency-auth.session-token`;
export const AGENCY_CALLBACK_COOKIE = `${prefix}agency-auth.callback-url`;
export const AGENCY_CSRF_COOKIE = `${AGENCY_USE_SECURE_COOKIES ? "__Host-" : ""}agency-auth.csrf-token`;
export const AGENCY_STATE_COOKIE = `${prefix}agency-auth.state`;
export const AGENCY_PKCE_COOKIE = `${prefix}agency-auth.pkce.code_verifier`;
export const AGENCY_NONCE_COOKIE = `${prefix}agency-auth.nonce`;
