/// <reference types="@cloudflare/workers-types" />

import { getSession } from '../../_session';
import type { Env } from '../../_types';

type FrameRow = {
  id: string;
  custom_name: string | null;
  image_key: string;
  expires_at: number | null;
  created_at: number;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const session = await getSession(context.env, context.request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const origin = new URL(context.request.url).origin;
  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const rows = await context.env.DB.prepare(
    'SELECT id, custom_name, image_key, expires_at, created_at FROM frames WHERE owner_id = ? ORDER BY created_at DESC'
  )
    .bind(session.userId)
    .all<FrameRow>();

  const frames = [] as Array<{
    id: string;
    displayName: string;
    expiresAt: number | null;
    remainingDays: number | null;
    shareUrl: string | null;
  }>;

  for (const row of rows.results ?? []) {
    const displayName = row.custom_name?.trim() ? row.custom_name.trim() : row.image_key;

    let remainingDays: number | null = null;
    if (row.expires_at !== null) {
      const diff = row.expires_at - nowMs;
      remainingDays = diff <= 0 ? 0 : Math.ceil(diff / dayMs);
    }

    const share = await context.env.DB.prepare(
      'SELECT id FROM share_urls WHERE frame_id = ? ORDER BY created_at DESC LIMIT 1'
    )
      .bind(row.id)
      .first<{ id: string }>();

    const shareUrl = share?.id ? `${origin}?f=${share.id}&openExternalBrowser=1` : null;

    frames.push({
      id: row.id,
      displayName,
      expiresAt: row.expires_at,
      remainingDays,
      shareUrl,
    });
  }

  return new Response(JSON.stringify({ frames }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const session = await getSession(context.env, context.request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(context.request.url);
  const frameId = url.searchParams.get('id');
  if (!frameId) {
    return new Response(JSON.stringify({ error: 'MISSING_ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const frame = await context.env.DB.prepare(
    'SELECT id, image_key FROM frames WHERE id = ? AND owner_id = ?'
  )
    .bind(frameId, session.userId)
    .first<{ id: string; image_key: string }>();

  if (!frame) {
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await context.env.FRAMES_BUCKET.delete(frame.image_key);

  await context.env.DB.prepare('DELETE FROM share_urls WHERE frame_id = ?').bind(frameId).run();
  await context.env.DB.prepare('DELETE FROM frames WHERE id = ?').bind(frameId).run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const session = await getSession(context.env, context.request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const viewer = await context.env.DB.prepare('SELECT id, plan FROM users WHERE id = ?')
    .bind(session.userId)
    .first<{ id: string; plan: string }>();

  if (!viewer) {
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (viewer.plan !== 'pro') {
    return new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await context.request.json().catch(() => ({} as any));
  const frameId = typeof body?.id === 'string' ? body.id : '';
  const rawName = typeof body?.customName === 'string' ? body.customName : '';

  if (!frameId) {
    return new Response(JSON.stringify({ error: 'MISSING_ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const trimmed = rawName.trim();
  if (trimmed.length > 80) {
    return new Response(JSON.stringify({ error: 'NAME_TOO_LONG' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const nextName: string | null = trimmed ? trimmed : null;
  const result = await context.env.DB.prepare(
    'UPDATE frames SET custom_name = ? WHERE id = ? AND owner_id = ?'
  )
    .bind(nextName, frameId, session.userId)
    .run();

  if (!result.success || (result.meta?.changes ?? 0) === 0) {
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, customName: nextName }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
