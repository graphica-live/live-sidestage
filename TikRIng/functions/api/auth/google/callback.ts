import type { Env } from '../../../_types';
import { createSession, setSessionCookie } from '../../../_session';
import { ensureAnonymousUserNumber, getInitialUserDisplayName } from '../../../_auth';
import { clearOAuthStateCookie, consumeOAuthState } from '../../../_oauthState';

/// 認可を成立させない場合は、必ず state Cookie を落としてから返す。
/// 中途半端に残すと、次の正規フローが古い state で弾かれる。
function deny(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'Set-Cookie': clearOAuthStateCookie() },
  });
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const code = url.searchParams.get('code');
  if (!code) return deny('Bad Request', 400);

  // このブラウザが始めた認可かを確認し、state を単回消費する。
  // これが無いと、攻撃者のアカウントの code を被害者に踏ませる login CSRF が成立する。
  const consumed = await consumeOAuthState(ctx.env, ctx.request, 'google');
  if (!consumed) return deny('Invalid OAuth state', 400);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: ctx.env.GOOGLE_CLIENT_ID,
      client_secret: ctx.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${ctx.env.SITE_URL}/api/auth/google/callback`,
      grant_type: 'authorization_code',
      code_verifier: consumed.codeVerifier,
    }),
  });
  // **ok を見ずに進めない。** 失敗レスポンスに access_token は無く、
  // そのまま進むと undefined の userinfo 取得へ落ちる。
  if (!tokenRes.ok) return deny('Bad Gateway', 502);

  const tokenData = await tokenRes.json<{ access_token?: string }>();
  if (!tokenData.access_token) return deny('Bad Gateway', 502);

  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userRes.ok) return deny('Bad Gateway', 502);

  const user = await userRes.json<{ id?: string; email?: string; name?: string }>();
  // id はこの後 users.id の素になる。欠けたまま進むと "google_undefined" という
  // 共有アカウントが出来上がる。
  if (!user.id) return deny('Bad Gateway', 502);

  const userId = `google_${user.id}`;
  const email = user.email ?? null;
  const now = Date.now();
  const anonymousNumber = await ensureAnonymousUserNumber(ctx.env, userId, email);
  const displayName = getInitialUserDisplayName(anonymousNumber, email, user.name);

  // D1にupsert
  await ctx.env.DB.prepare(
    `INSERT INTO users (id, provider, email, display_name, created_at)
     VALUES (?, 'google', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email=excluded.email,
        display_name=excluded.display_name,
        custom_display_name=CASE
          WHEN NULLIF(TRIM(users.custom_display_name), '') IS NOT NULL THEN users.custom_display_name
          ELSE excluded.display_name
        END`
  ).bind(userId, email, displayName, now).run();

  const token = await createSession(ctx.env, userId);

  return new Response(null, {
    status: 302,
    headers: [
      ['Location', '/'],
      ['Set-Cookie', setSessionCookie(token)],
      // 用済みの state Cookie を残さない。
      ['Set-Cookie', clearOAuthStateCookie()],
    ],
  });
};
