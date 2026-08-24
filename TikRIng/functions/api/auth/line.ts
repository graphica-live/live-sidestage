import type { Env } from '../../_types';
import { startOAuthState } from '../../_oauthState';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  // state は生成するだけでは意味がない。KV と Cookie に残して callback 側で照合する。
  const { state, codeChallenge, setCookie } = await startOAuthState(ctx.env, 'line');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: ctx.env.LINE_CHANNEL_ID,
    redirect_uri: `${ctx.env.SITE_URL}/api/auth/line/callback`,
    state,
    scope: 'profile openid email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://access.line.me/oauth2/v2.1/authorize?${params}`,
      'Set-Cookie': setCookie,
    },
  });
};
