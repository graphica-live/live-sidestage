import type { Env } from '../../../_types';
import { createSession, setSessionCookie } from '../../../_session';
import { ensureAnonymousUserNumber, getInitialUserDisplayName } from '../../../_auth';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const code = url.searchParams.get('code');
  if (!code) return new Response('Bad Request', { status: 400 });

  const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${ctx.env.SITE_URL}/api/auth/line/callback`,
      client_id: ctx.env.LINE_CHANNEL_ID,
      client_secret: ctx.env.LINE_CHANNEL_SECRET,
    }),
  });
  const tokenData = await tokenRes.json<{ access_token: string }>();

  const profileRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileRes.json<{ userId: string; displayName: string; email?: string }>();

  const userId = `line_${profile.userId}`;
  const now = Date.now();
  const anonymousNumber = await ensureAnonymousUserNumber(ctx.env, userId, profile.email ?? null);
  const displayName = getInitialUserDisplayName(anonymousNumber, profile.email ?? null, profile.displayName);

  await ctx.env.DB.prepare(
    `INSERT INTO users (id, provider, email, display_name, created_at)
     VALUES (?, 'line', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name=excluded.display_name,
        custom_display_name=CASE
          WHEN NULLIF(TRIM(users.custom_display_name), '') IS NOT NULL THEN users.custom_display_name
          ELSE excluded.display_name
        END`
  ).bind(userId, profile.email ?? null, displayName, now).run();

  const token = await createSession(ctx.env, userId);

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': setSessionCookie(token),
    },
  });
};
