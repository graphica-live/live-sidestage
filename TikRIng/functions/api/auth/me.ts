import type { Env } from '../../_types';
import { getSession } from '../../_session';
import { getEffectivePlan, getResolvedUserDisplayName, isAdminEmail } from '../../_auth';

type UserRow = {
  id: string;
  provider: string;
  email: string | null;
  display_name: string | null;
  custom_display_name: string | null;
  tiktok_profile_id: string | null;
  anonymous_display_number: number | null;
  plan: string;
};

type UpdateDisplayNameRequest = {
  displayName?: unknown;
  tiktokProfileId?: unknown;
};

function normalizeTikTokProfileId(value: unknown) {
  if (value === null) {
    return { value: null };
  }

  if (typeof value !== 'string') {
    return { error: 'TIKTOK_PROFILE_ID_INVALID' as const };
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return { value: null };
  }

  const normalizedValue = trimmedValue.replace(/^@+/, '');
  if (!normalizedValue) {
    return { value: null };
  }

  if (!/^[A-Za-z0-9._]+$/.test(normalizedValue)) {
    return { error: 'TIKTOK_PROFILE_ID_INVALID' as const };
  }

  if (normalizedValue.length > 64) {
    return { error: 'TIKTOK_PROFILE_ID_TOO_LONG' as const };
  }

  return { value: normalizedValue };
}

async function getResponseUser(env: Env, userId: string) {
  const user = await env.DB.prepare(
    `SELECT id, provider, email,
        display_name,
        custom_display_name,
        tiktok_profile_id,
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
        tiktok_profile_id: user.tiktok_profile_id,
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

  const hasDisplayName = Object.prototype.hasOwnProperty.call(body, 'displayName');
  const hasTikTokProfileId = Object.prototype.hasOwnProperty.call(body, 'tiktokProfileId');
  const requestedDisplayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const normalizedTikTokProfileId = hasTikTokProfileId ? normalizeTikTokProfileId(body.tiktokProfileId) : null;

  if (!hasDisplayName && !hasTikTokProfileId) {
    return new Response(JSON.stringify({ error: 'NO_UPDATABLE_FIELDS' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const currentUser = await ctx.env.DB.prepare(
    'SELECT id, email FROM users WHERE id = ?'
  ).bind(session.userId).first<{ id: string; email: string | null }>();

  if (!currentUser) {
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (hasDisplayName && !requestedDisplayName) {
    return new Response(JSON.stringify({ error: 'DISPLAY_NAME_REQUIRED' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (normalizedTikTokProfileId?.error) {
    return new Response(JSON.stringify({ error: normalizedTikTokProfileId.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const updates: string[] = [];
  const bindings: Array<string | null> = [];

  if (hasDisplayName) {
    updates.push('custom_display_name = ?');
    bindings.push(requestedDisplayName);
  }

  if (hasTikTokProfileId && normalizedTikTokProfileId) {
    updates.push('tiktok_profile_id = ?');
    bindings.push(normalizedTikTokProfileId.value);
  }

  await ctx.env.DB.prepare(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...bindings, session.userId).run();

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
