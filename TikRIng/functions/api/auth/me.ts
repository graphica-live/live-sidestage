import type { Env } from '../../_types';
import { getSession } from '../../_session';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const session = await getSession(ctx.env, ctx.request);
  if (!session) {
    return new Response(JSON.stringify({ user: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = await ctx.env.DB.prepare(
    'SELECT id, provider, display_name, plan FROM users WHERE id = ?'
  ).bind(session.userId).first();

  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
