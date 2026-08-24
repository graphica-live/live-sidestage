import type { Env } from '../../_types';
import { startOAuthState } from '../../_oauthState';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  // state は生成するだけでは意味がない。KV と Cookie に残して callback 側で照合する。
  const { state, codeChallenge, setCookie } = await startOAuthState(ctx.env, 'google');

  const params = new URLSearchParams({
    client_id: ctx.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${ctx.env.SITE_URL}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      'Set-Cookie': setCookie,
    },
  });
};
