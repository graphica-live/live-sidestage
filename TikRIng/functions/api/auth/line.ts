import type { Env } from '../../_types';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: ctx.env.LINE_CHANNEL_ID,
    redirect_uri: `${ctx.env.SITE_URL}/api/auth/line/callback`,
    state,
    scope: 'profile openid email',
  });
  return Response.redirect(`https://access.line.me/oauth2/v2.1/authorize?${params}`, 302);
};
