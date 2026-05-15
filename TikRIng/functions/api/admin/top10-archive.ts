/// <reference types="@cloudflare/workers-types" />

import type { Env } from '../../_types';
import { getSession } from '../../_session';
import { isAdminEmail } from '../../_auth';

type ArchiveRow = {
  id: string;
  owner_id: string | null;
  owner_email: string | null;
  owner_display_name: string | null;
  custom_name: string | null;
  image_key: string;
  created_at: number;
  expires_at: number | null;
  view_count: number | null;
  good_count: number | null;
  wear_count: number | null;
  user_deleted: number;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const session = await getSession(context.env, context.request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = await context.env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(session.userId)
    .first<{ email: string | null }>();

  if (!user || !isAdminEmail(user.email)) {
    return new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(context.request.url);
  const origin = url.origin;

  // ever_top10=1 の全フレームを返す（ユーザー削除済みも含む）
  const rows = await context.env.DB.prepare(
    `SELECT f.id, f.owner_id,
       u.email AS owner_email,
       COALESCE(NULLIF(TRIM(u.custom_display_name), ''), NULLIF(TRIM(u.display_name), ''), u.email) AS owner_display_name,
       f.custom_name, f.image_key,
       f.created_at, f.expires_at,
       f.view_count, f.good_count, f.wear_count,
       f.user_deleted
     FROM frames f
     LEFT JOIN users u ON u.id = f.owner_id
     WHERE f.ever_top10 = 1
     ORDER BY COALESCE(f.wear_count, 0) DESC, f.created_at DESC`
  ).all<ArchiveRow>();

  const frames = (rows.results ?? []).map((row) => ({
    id: row.id,
    displayName: row.custom_name?.trim() || row.image_key,
    ownerEmail: row.owner_email,
    ownerDisplayName: row.owner_display_name,
    imageKey: row.image_key,
    thumbnailUrl: `${origin}/api/share/thumbnail/${encodeURIComponent(row.id)}.png?raw=1`,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    viewCount: row.view_count ?? 0,
    goodCount: row.good_count ?? 0,
    wearCount: row.wear_count ?? 0,
    userDeleted: row.user_deleted === 1,
  }));

  return new Response(JSON.stringify({ frames, total: frames.length }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
};
