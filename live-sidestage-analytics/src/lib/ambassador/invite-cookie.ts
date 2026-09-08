// アンバサダー招待URL経由のサインアップだけを識別するためのCookie名。
// src/app/api/ambassador/invite/start/route.ts がセットし、
// authOptions.events.createUser(src/lib/auth.ts)が読む。
// 新規作成されたUserのときだけ効くため、既存ユーザーの誤クレームは起きない
// (events.createUserは実際に新規Userが作られた場合にのみ発火する)。
export const AMBASSADOR_INVITE_COOKIE = "ambassador_invite_token";

/** Cookieの有効時間。サインアップに要する時間より十分長く、無関係な用途に使い回されない程度に短く。 */
export const AMBASSADOR_INVITE_COOKIE_MAX_AGE_SECONDS = 10 * 60;
