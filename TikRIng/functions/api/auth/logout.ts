import type { Env } from '../../_types';
import { clearSessionCookie } from '../../_session';

export const onRequestPost: PagesFunction<Env> = async () => {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': clearSessionCookie(),
    },
  });
};
