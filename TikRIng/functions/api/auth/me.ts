import type { Env } from '../../_types';
import { getSession } from '../../_session';
import { getEffectivePlan, isAdminEmail } from '../../_auth';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const session = await getSession(ctx.env, ctx.request);
  if (!session) {
    return new Response(JSON.stringify({ user: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = await ctx.env.DB.prepare(
    `SELECT id, provider, email,
        COALESCE(NULLIF(TRIM(custom_display_name), ''), NULLIF(TRIM(display_name), '')) AS display_name,
        plan
     FROM users
     WHERE id = ?`
  ).bind(session.userId).first<{
    id: string;
    provider: string;
    email: string | null;
    display_name: string | null;
    plan: string;
  }>();

  const responseUser = user
    ? {
        id: user.id,
        provider: user.provider,
        email: user.email,
        display_name: user.display_name,
        plan: getEffectivePlan(user.plan, user.email),
        isAdmin: isAdminEmail(user.email),
      }
    : null;

  return new Response(JSON.stringify({ user: responseUser }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
