/// <reference types="@cloudflare/workers-types" />

import { getSession } from '../../_session';
import type { Env } from '../../_types';
import { isAdminEmail } from '../../_auth';

const ORPHAN_PAGE_SIZE = 50;
const R2_SCAN_BATCH_SIZE = 250;

type Viewer = {
  id: string;
  email: string | null;
};

type FrameListItem = {
  id: string;
  kind: 'orphan';
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
};

type OrphanMeta = {
  totalCount: null;
  registeredCount: number;
  orphanCount: null;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
};

async function getViewer(context: EventContext<Env, string, unknown>, userId: string): Promise<Viewer | null> {
  return context.env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
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

function isIgnoredObjectKey(key: string) {
  return key.startsWith('masks/') || key.startsWith('previews/');
}

async function getExistingImageKeys(context: EventContext<Env, string, unknown>, keys: string[]) {
  if (keys.length === 0) {
    return new Set<string>();
  }

  const placeholders = keys.map(() => '?').join(', ');
  const rows = await context.env.DB.prepare(
    `SELECT image_key FROM frames WHERE image_key IN (${placeholders})`
  )
    .bind(...keys)
    .all<{ image_key: string }>();

  return new Set((rows.results ?? []).map((row) => row.image_key));
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
  if (!viewer || !isAdminEmail(viewer.email)) {
    return new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(context.request.url);
  const page = parsePositiveInteger(url.searchParams.get('page'), 1, 100000);
  const pageSize = parsePositiveInteger(url.searchParams.get('pageSize'), ORPHAN_PAGE_SIZE, ORPHAN_PAGE_SIZE);
  const offset = (page - 1) * pageSize;
  const registeredCountRow = await context.env.DB.prepare('SELECT COUNT(*) AS count FROM frames')
    .first<{ count: number }>();
  const registeredCount = registeredCountRow?.count ?? 0;

  const frames: FrameListItem[] = [];
  let skipped = 0;
  let hasNextPage = false;
  let cursor: string | undefined;

  while (true) {
    const listed = await context.env.FRAMES_BUCKET.list({ cursor, limit: R2_SCAN_BATCH_SIZE });
    const candidates = listed.objects.filter((object) => !isIgnoredObjectKey(object.key));
    const existingKeys = await getExistingImageKeys(
      context,
      candidates.map((object) => object.key)
    );

    for (const object of candidates) {
      if (existingKeys.has(object.key)) {
        continue;
      }

      if (skipped < offset) {
        skipped += 1;
        continue;
      }

      if (frames.length < pageSize) {
        frames.push({
          id: object.key,
          kind: 'orphan',
          storageKey: object.key,
          displayName: object.key,
          createdAt: object.uploaded.getTime(),
          expiresAt: null,
          remainingDays: null,
          shareUrl: null,
          passwordProtected: false,
          passwordValue: null,
          ownerId: null,
          ownerEmail: null,
          ownerDisplayName: null,
          viewCount: 0,
        });
        continue;
      }

      hasNextPage = true;
      break;
    }

    if (hasNextPage || !listed.truncated || !listed.cursor) {
      break;
    }

    cursor = listed.cursor;
  }

  const meta: OrphanMeta = {
    totalCount: null,
    registeredCount,
    orphanCount: null,
    page,
    pageSize,
    hasNextPage,
  };

  return new Response(JSON.stringify({ frames, meta }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
