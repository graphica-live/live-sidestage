import type { Env } from '../../_types';
import { getSession } from '../../_session';
import { getEffectivePlan, getResolvedUserDisplayName, isAdminEmail } from '../../_auth';

type UserRow = {
  id: string;
  provider: string;
  email: string | null;
  display_name: string | null;
  custom_display_name: string | null;
  anonymous_display_number: number | null;
  plan: string;
};

type UpdateDisplayNameRequest = {
  displayName?: unknown;
};

async function getResponseUser(env: Env, userId: string) {
  const user = await env.DB.prepare(
    `SELECT id, provider, email,
        display_name,
        custom_display_name,
        (SELECT id FROM anonymous_user_numbers WHERE user_id = users.id) AS anonymous_display_number,
        plan
     FROM users
     WHERE id = ?`
  ).bind(userId).first<UserRow>();

  return user
    ? {
        id: user.id,
        provider: user.provider,
        email: user.email,
        display_name: getResolvedUserDisplayName({
          userId: user.id,
          email: user.email,
          anonymousDisplayNumber: user.anonymous_display_number,
          customDisplayName: user.custom_display_name,
          displayName: user.display_name,
        }),
        plan: getEffectivePlan(user.plan, user.email),
        isAdmin: isAdminEmail(user.email),
      }
    : null;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const session = await getSession(ctx.env, ctx.request);
  if (!session) {
    return new Response(JSON.stringify({ user: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const responseUser = await getResponseUser(ctx.env, session.userId);

  return new Response(JSON.stringify({ user: responseUser }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
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

  const currentUser = await ctx.env.DB.prepare(
    'SELECT id, email FROM users WHERE id = ?'
  ).bind(session.userId).first<{ id: string; email: string | null }>();

  if (!currentUser) {
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!displayName) {
    return new Response(JSON.stringify({ error: 'DISPLAY_NAME_REQUIRED' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await ctx.env.DB.prepare(
    'UPDATE users SET custom_display_name = ? WHERE id = ?'
  ).bind(displayName, session.userId).run();

  const responseUser = await getResponseUser(ctx.env, session.userId);
  if (!responseUser) {
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ user: responseUser }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
