/// <reference types="@cloudflare/workers-types" />

import { getSession } from '../../_session';
import { decryptFramePassword } from '../../_framePassword';
import type { Env } from '../../_types';
import { isAdminEmail, isEffectivePro } from '../../_auth';

const ADMIN_PAGE_SIZE = 50;

type AdminSortOption = 'created_desc' | 'created_asc' | 'owner_asc' | 'owner_desc' | 'name_asc' | 'name_desc' | 'expires_asc' | 'expires_desc' | 'views_desc';

const ADMIN_SORT_SQL: Record<AdminSortOption, string> = {
  created_desc: 'f.created_at DESC',
  created_asc: 'f.created_at ASC',
  owner_asc: "LOWER(COALESCE(u.display_name, u.email, '')) ASC, f.created_at DESC",
  owner_desc: "LOWER(COALESCE(u.display_name, u.email, '')) DESC, f.created_at DESC",
  name_asc: 'LOWER(COALESCE(f.custom_name, f.image_key)) ASC, f.created_at DESC',
  name_desc: 'LOWER(COALESCE(f.custom_name, f.image_key)) DESC, f.created_at DESC',
  expires_asc: 'CASE WHEN f.expires_at IS NULL THEN 1 ELSE 0 END ASC, f.expires_at ASC, f.created_at DESC',
  expires_desc: 'CASE WHEN f.expires_at IS NULL THEN 1 ELSE 0 END ASC, f.expires_at DESC, f.created_at DESC',
  views_desc: 'COALESCE(f.view_count, 0) DESC, f.created_at DESC',
};

type FrameRow = {
  id: string;
  owner_id: string | null;
  owner_email: string | null;
  owner_display_name: string | null;
  custom_name: string | null;
  image_key: string;
  opening_mask_key: string | null;
  expires_at: number | null;
  password_hash: string | null;
  password_ciphertext?: string | null;
  created_at: number;
  view_count: number | null;
  wear_count: number | null;
};

type FrameListItem = {
  id: string;
  kind: 'frame';
  storageKey: string;
  displayName: string;
  createdAt: number | null;
  expiresAt: number | null;
  remainingDays: number | null;
  shareUrl: string | null;
  passwordProtected: boolean;
  passwordValue: string | null;
  ownerId: string | null;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  viewCount?: number;
  wearCount?: number;
};

type FramesMeta = {
  totalCount: number;
  registeredCount: number;
  orphanCount: number | null;
  page: number;
  pageSize: number;
};

type Viewer = {
  id: string;
  email: string | null;
  plan: string;
};

async function getViewer(context: EventContext<Env, string, unknown>, userId: string): Promise<Viewer | null> {
  return context.env.DB.prepare('SELECT id, email, plan FROM users WHERE id = ?')
    .bind(userId)
    .first<Viewer>();
}

function parsePositiveInteger(raw: string | null, fallback: number, max: number) {
  const value = Number(raw ?? '');
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.min(max, Math.floor(value));
}

function parseAdminSort(raw: string | null): AdminSortOption {
  if (raw && raw in ADMIN_SORT_SQL) {
    return raw as AdminSortOption;
  }

  return 'created_desc';
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const session = await getSession(context.env, context.request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const viewer = await getViewer(context, session.userId);
  if (!viewer) {
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(context.request.url);
  const previewStorageKey = url.searchParams.get('storageKey');
  const isPreviewRequest = url.searchParams.get('preview') === '1';
  const scope = url.searchParams.get('scope');
  const isAdmin = isAdminEmail(viewer.email);
  const isAdminScope = scope === 'all';

  if (previewStorageKey && isPreviewRequest) {
    if (!isAdmin) {
      return new Response('Forbidden', {
        status: 403,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    const object = await context.env.FRAMES_BUCKET.get(previewStorageKey);

    if (object === null) {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'no-store');
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(object.body, {
      headers,
      status: 200,
    });
  }

  if (isAdminScope && !isAdmin) {
    return new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 既に無料(plan!=pro)の状態で、過去にProで作った「無期限フレーム」が残っている場合に備え、
  // フレーム管理を開いたタイミングで一度だけ「現在+90日」に補正する（expires_at IS NULL のみ対象）
  if (!isAdminScope && !isEffectivePro(viewer.plan, viewer.email)) {
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const newExpiresAt = Date.now() + ninetyDaysMs;
    await context.env.DB.prepare(
      'UPDATE frames SET expires_at = ? WHERE owner_id = ? AND expires_at IS NULL'
    )
      .bind(newExpiresAt, session.userId)
      .run();
  }

  const origin = new URL(context.request.url).origin;
  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  if (isAdminScope) {
    const page = parsePositiveInteger(url.searchParams.get('page'), 1, 100000);
    const pageSize = parsePositiveInteger(url.searchParams.get('pageSize'), ADMIN_PAGE_SIZE, ADMIN_PAGE_SIZE);
    const offset = (page - 1) * pageSize;
    const sort = parseAdminSort(url.searchParams.get('sort'));
    const registeredCountRow = await context.env.DB.prepare('SELECT COUNT(*) AS count FROM frames')
      .first<{ count: number }>();
    const registeredCount = registeredCountRow?.count ?? 0;
    const orderSql = ADMIN_SORT_SQL[sort];
    const rows = await context.env.DB.prepare(
      `SELECT f.id, f.owner_id, u.email AS owner_email, u.display_name AS owner_display_name,
        f.custom_name, f.image_key, f.opening_mask_key, f.expires_at, f.password_hash, f.created_at, f.view_count, f.wear_count
       FROM frames f
       LEFT JOIN users u ON u.id = f.owner_id
       ORDER BY ${orderSql}
       LIMIT ? OFFSET ?`
    )
      .bind(pageSize, offset)
      .all<FrameRow>();

    const frames: FrameListItem[] = [];

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

      const shareUrl = share?.id
        ? `${origin}?f=${share.id}&openExternalBrowser=1`
        : row.owner_id === null
          ? `${origin}?f=${row.id}&openExternalBrowser=1`
          : null;

      frames.push({
        id: row.id,
        kind: 'frame',
        storageKey: row.image_key,
        displayName,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        remainingDays,
        shareUrl,
        passwordProtected: Boolean(row.password_hash),
        passwordValue: null,
        ownerId: row.owner_id,
        ownerEmail: row.owner_email,
        ownerDisplayName: row.owner_display_name,
        viewCount: row.view_count ?? 0,
        wearCount: row.wear_count ?? 0,
      });
    }

    const meta: FramesMeta = {
      totalCount: registeredCount,
      registeredCount,
      orphanCount: null,
      page,
      pageSize,
    };

    return new Response(JSON.stringify({ frames, meta }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rows = await context.env.DB.prepare(
    `SELECT f.id, f.owner_id, u.email AS owner_email, u.display_name AS owner_display_name,
      f.custom_name, f.image_key, f.opening_mask_key, f.expires_at, f.password_hash, f.password_ciphertext, f.created_at, f.view_count, f.wear_count
     FROM frames f
     LEFT JOIN users u ON u.id = f.owner_id
     WHERE f.owner_id = ?
     ORDER BY f.created_at DESC`
  )
    .bind(session.userId)
    .all<FrameRow>();

  const frames: FrameListItem[] = [];

  for (const row of rows.results ?? []) {
    const displayName = row.custom_name?.trim() ? row.custom_name.trim() : row.image_key;
    const passwordProtected = Boolean(row.password_hash);
    const passwordValue = passwordProtected
      ? await decryptFramePassword(context.env, row.password_ciphertext ?? null)
      : null;

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

    const shareUrl = share?.id
      ? `${origin}?f=${share.id}&openExternalBrowser=1`
      : row.owner_id === null
        ? `${origin}?f=${row.id}&openExternalBrowser=1`
        : null;

    frames.push({
      id: row.id,
      kind: 'frame',
      storageKey: row.image_key,
      displayName,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      remainingDays,
      shareUrl,
      passwordProtected,
      passwordValue,
      ownerId: row.owner_id,
      ownerEmail: row.owner_email,
      ownerDisplayName: row.owner_display_name,
      viewCount: row.view_count ?? 0,
      wearCount: row.wear_count ?? 0,
    });
  }

  return new Response(JSON.stringify({
    frames,
    meta: {
      totalCount: frames.length,
      registeredCount: rows.results?.length ?? 0,
      orphanCount: 0,
      page: 1,
      pageSize: frames.length,
    },
  }), {
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

  const viewer = await getViewer(context, session.userId);
  if (!viewer) {
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const isAdmin = isAdminEmail(viewer.email);

  const url = new URL(context.request.url);
  const frameId = url.searchParams.get('id');
  const storageKey = url.searchParams.get('storageKey');

  if (storageKey) {
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const linkedFrame = await context.env.DB.prepare(
      'SELECT id FROM frames WHERE image_key = ? OR id = ? LIMIT 1'
    )
      .bind(storageKey, storageKey)
      .first<{ id: string }>();

    if (linkedFrame) {
      return new Response(JSON.stringify({ error: 'FRAME_EXISTS_IN_DB' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await context.env.FRAMES_BUCKET.delete(storageKey);

    return new Response(JSON.stringify({ ok: true, kind: 'orphan' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!frameId) {
    return new Response(JSON.stringify({ error: 'MISSING_ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const frame = await context.env.DB.prepare(
    'SELECT id, owner_id, image_key, opening_mask_key FROM frames WHERE id = ?'
  )
    .bind(frameId)
    .first<{ id: string; owner_id: string | null; image_key: string; opening_mask_key: string | null }>();

  if (!frame || (!isAdmin && frame.owner_id !== session.userId)) {
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await context.env.FRAMES_BUCKET.delete(frame.image_key);
  if (frame.opening_mask_key) {
    await context.env.FRAMES_BUCKET.delete(frame.opening_mask_key);
  }
  await context.env.FRAMES_BUCKET.delete(`previews/${frame.id}.png`);

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

  const viewer = await getViewer(context, session.userId);
  if (!viewer) {
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const isAdmin = isAdminEmail(viewer.email);

  if (!isAdmin && !isEffectivePro(viewer.plan, viewer.email)) {
    return new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await context.request.json<{ id?: unknown; customName?: unknown }>().catch(
    () => ({ id: undefined, customName: undefined })
  );
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
  const result = isAdmin
    ? await context.env.DB.prepare(
        'UPDATE frames SET custom_name = ? WHERE id = ?'
      )
        .bind(nextName, frameId)
        .run()
    : await context.env.DB.prepare(
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
