import type { Env } from './_types';

/// OAuth の state と PKCE code_verifier の発行・単回消費。
///
/// **これが無いと OAuth login CSRF が成立する。** 攻撃者が自分のアカウントの
/// authorization code を被害者のブラウザへ踏ませると、被害者は気づかないまま
/// 攻撃者のアカウントでログインした状態になり、そこへアップロードしたフレームや
/// 課金が攻撃者の手元に残る。
///
/// 防御は2枚重ねにしてある。
///
/// 1. **Cookie と クエリの state が一致すること** — 攻撃者が自分のブラウザで
///    始めた認可の応答は、被害者のブラウザには対応する Cookie が無いので通らない
/// 2. **KV 側の state を単回消費すること** — 同じ code / state の再送を弾く
///
/// あわせて PKCE(S256) を使い、code を横取りされても交換できないようにする。

const STATE_TTL_SEC = 600; // 10分。認可画面の滞在時間として十分で、放置分は自然に消える
const STATE_COOKIE = 'oauth_state';

interface StoredState {
  codeVerifier: string;
  provider: string;
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

async function toCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}

function getCookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? match[1] : null;
}

export interface StartedOAuthState {
  state: string;
  codeChallenge: string;
  setCookie: string;
}

/// 認可の開始側で呼ぶ。state を KV と Cookie の両方へ置く。
export async function startOAuthState(env: Env, provider: string): Promise<StartedOAuthState> {
  const state = randomToken();
  const codeVerifier = randomToken();
  const payload: StoredState = { codeVerifier, provider };

  await env.SESSIONS.put(`oauth_state_${state}`, JSON.stringify(payload), {
    expirationTtl: STATE_TTL_SEC,
  });

  return {
    state,
    codeChallenge: await toCodeChallenge(codeVerifier),
    // 認可からの復帰は provider からのトップレベル GET リダイレクトなので SameSite=Lax でも送られる。
    setCookie: `${STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${STATE_TTL_SEC}`,
  };
}

/// callback 側で呼ぶ。**成功しても失敗しても state は消費する**（再利用を許さない）。
/// 返り値が null なら認可を成立させてはいけない。
export async function consumeOAuthState(
  env: Env,
  request: Request,
  provider: string,
): Promise<{ codeVerifier: string } | null> {
  const stateParam = new URL(request.url).searchParams.get('state');
  const stateCookie = getCookieValue(request, STATE_COOKIE);

  // Cookie が無い＝このブラウザが始めた認可ではない。
  if (!stateParam || !stateCookie || stateParam !== stateCookie) return null;

  const key = `oauth_state_${stateParam}`;
  const raw = await env.SESSIONS.get(key);
  // 単回消費。読めた場合も読めなかった場合も消しておく。
  await env.SESSIONS.delete(key);
  if (!raw) return null;

  let stored: StoredState;
  try {
    stored = JSON.parse(raw) as StoredState;
  } catch {
    return null;
  }

  // google で始めた state を line の callback で使う、といった取り違えを防ぐ。
  if (stored.provider !== provider) return null;
  if (!stored.codeVerifier) return null;

  return { codeVerifier: stored.codeVerifier };
}

export function clearOAuthStateCookie(): string {
  return `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
