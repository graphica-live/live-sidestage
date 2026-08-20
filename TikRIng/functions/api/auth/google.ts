import type { Env } from '../../_types';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: ctx.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${ctx.env.SITE_URL}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
};
