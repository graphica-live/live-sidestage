import type { Env } from '../../_types';
import { getSession } from '../../_session';
import { getEffectivePlan, isAdminEmail } from '../../_auth';

type UpdateDisplayNameRequest = {
  displayName?: unknown;
};

type UserRow = {
  id: string;
  provider: string;
  email: string | null;
  display_name: string | null;
  plan: string;
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const session = await getSession(ctx.env, ctx.request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: UpdateDisplayNameRequest;
  try {
    body = await ctx.request.json<UpdateDisplayNameRequest>();
  } catch {
    return new Response(JSON.stringify({ error: 'INVALID_JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rawDisplayName = typeof body.displayName === 'string' ? body.displayName : '';
  const displayName = rawDisplayName.trim();

  if (!displayName) {
    return new Response(JSON.stringify({ error: 'DISPLAY_NAME_REQUIRED' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await ctx.env.DB.prepare(
    'UPDATE users SET custom_display_name = ? WHERE id = ?'
  ).bind(displayName, session.userId).run();

  const user = await ctx.env.DB.prepare(
    `SELECT id, provider, email,
        COALESCE(NULLIF(TRIM(custom_display_name), ''), NULLIF(TRIM(display_name), '')) AS display_name,
        plan
     FROM users
     WHERE id = ?`
  ).bind(session.userId).first<UserRow>();

  if (!user) {
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    user: {
      id: user.id,
      provider: user.provider,
      email: user.email,
      display_name: user.display_name,
      plan: getEffectivePlan(user.plan, user.email),
      isAdmin: isAdminEmail(user.email),
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};