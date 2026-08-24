import type { Env } from '../../../_types';
import { createSession, setSessionCookie } from '../../../_session';
import { ensureAnonymousUserNumber, getInitialUserDisplayName } from '../../../_auth';
import { clearOAuthStateCookie, consumeOAuthState } from '../../../_oauthState';

/// 認可を成立させない場合は、必ず state Cookie を落としてから返す。
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

  const consumed = await consumeOAuthState(ctx.env, ctx.request, 'line');
  if (!consumed) return deny('Invalid OAuth state', 400);

  const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${ctx.env.SITE_URL}/api/auth/line/callback`,
      client_id: ctx.env.LINE_CHANNEL_ID,
      client_secret: ctx.env.LINE_CHANNEL_SECRET,
      code_verifier: consumed.codeVerifier,
    }),
  });
  // **ok を見ずに進めない。** 交換に失敗すると profile.userId が undefined になり、
  // "line_undefined" という 1 つのアカウントを失敗者全員が共有してしまう
  // （互いのフレームを閲覧・操作できる状態になる）。
  if (!tokenRes.ok) return deny('Bad Gateway', 502);

  const tokenData = await tokenRes.json<{ access_token?: string }>();
  if (!tokenData.access_token) return deny('Bad Gateway', 502);

  const profileRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!profileRes.ok) return deny('Bad Gateway', 502);

  const profile = await profileRes.json<{ userId?: string; displayName?: string; email?: string }>();
  if (!profile.userId) return deny('Bad Gateway', 502);

  const userId = `line_${profile.userId}`;
  const email = profile.email ?? null;
  const now = Date.now();
  const anonymousNumber = await ensureAnonymousUserNumber(ctx.env, userId, email);
  const displayName = getInitialUserDisplayName(anonymousNumber, email, profile.displayName);

  await ctx.env.DB.prepare(
    `INSERT INTO users (id, provider, email, display_name, created_at)
     VALUES (?, 'line', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
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
      ['Set-Cookie', clearOAuthStateCookie()],
    ],
  });
};
