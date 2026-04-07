import type { Env } from '../../../_types';
import { createSession, setSessionCookie } from '../../../_session';
import { getInitialUserDisplayName } from '../../../_auth';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const code = url.searchParams.get('code');
  if (!code) return new Response('Bad Request', { status: 400 });

  // トークン取得
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: ctx.env.GOOGLE_CLIENT_ID,
      client_secret: ctx.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${ctx.env.SITE_URL}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  const tokenData = await tokenRes.json<{ access_token: string }>();

  // ユーザー情報取得
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const user = await userRes.json<{ id: string; email: string; name: string }>();

  const userId = `google_${user.id}`;
  const now = Date.now();
  const displayName = getInitialUserDisplayName(userId, user.email, user.name);

  // D1にupsert
  await ctx.env.DB.prepare(
    `INSERT INTO users (id, provider, email, display_name, created_at)
     VALUES (?, 'google', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email=excluded.email, display_name=excluded.display_name`
  ).bind(userId, user.email, displayName, now).run();

  const token = await createSession(ctx.env, userId);

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': setSessionCookie(token),
    },
  });
};
