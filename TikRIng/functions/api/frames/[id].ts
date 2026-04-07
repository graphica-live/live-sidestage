import type { Env } from '../../_types';
import { getSession, resolveGoodActor } from '../../_session';
import { createFrameAccessToken, decryptFramePassword, hashFramePassword, verifyFrameAccessToken } from '../../_framePassword';
import { isAdminEmail } from '../../_auth';

type ShareRow = {
  frame_id: string;
};

type FrameRow = {
  id: string;
  owner_id: string | null;
  image_key: string;
  opening_mask_key: string | null;
  expires_at: number | null;
  password_hash: string | null;
  password_ciphertext: string | null;
  view_count: number | null;
};

type ResolvedFrame = {
  frameId: string;
  ownerId: string | null;
  imageKey: string;
  openingMaskKey: string | null;
  expiresAt: number | null;
  passwordHash: string | null;
  passwordCiphertext: string | null;
  viewCount: number;
};

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

async function hasFrameAccess(context: EventContext<Env, string, unknown>, frameId: string) {
  const accessToken = new URL(context.request.url).searchParams.get('accessToken');
  return verifyFrameAccessToken(context.env, accessToken, frameId);
}

async function resolveFrame(context: EventContext<Env, string, unknown>): Promise<ResolvedFrame | null> {
  let id = context.params.id as string;

  if (!id) {
    return null;
  }

  const shareRow = await context.env.DB.prepare(
    'SELECT frame_id FROM share_urls WHERE id = ?'
  ).bind(id).first<ShareRow>();

  if (shareRow?.frame_id) {
    id = shareRow.frame_id;
  }

  const frameRow = await context.env.DB.prepare(
    'SELECT id, owner_id, image_key, opening_mask_key, expires_at, password_hash, password_ciphertext, view_count FROM frames WHERE id = ?'
  )
    .bind(id)
    .first<FrameRow>();

  if (!frameRow) {
    return null;
  }

  return {
    frameId: frameRow.id,
    ownerId: frameRow.owner_id,
    imageKey: frameRow.image_key,
    openingMaskKey: frameRow.opening_mask_key ?? null,
    expiresAt: frameRow.expires_at ?? null,
    passwordHash: frameRow.password_hash ?? null,
    passwordCiphertext: frameRow.password_ciphertext ?? null,
    viewCount: frameRow.view_count ?? 0,
  };
}

async function canOwnerAccessFrame(context: EventContext<Env, string, unknown>, ownerId: string | null) {
  if (!ownerId) {
    return false;
  }

  const session = await getSession(context.env, context.request);
  if (!session) {
    return false;
  }

  if (session.userId === ownerId) {
    return true;
  }

  const viewer = await context.env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(session.userId)
    .first<{ email: string | null }>();

  return isAdminEmail(viewer?.email);
}

async function recordFrameView(context: EventContext<Env, string, unknown>, frameId: string) {
  const actor = await resolveGoodActor(context.env, context.request);
  const insertedAt = Date.now();

  await context.env.DB.prepare(
    `INSERT INTO frame_view_events (id, frame_id, actor_type, actor_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), frameId, actor.actorType, actor.actorId, insertedAt)
    .run();

  const recordResult = await context.env.DB.prepare(
    `INSERT OR IGNORE INTO frame_views (frame_id, actor_type, actor_id, created_at)
     VALUES (?, ?, ?, ?)`
  )
    .bind(frameId, actor.actorType, actor.actorId, insertedAt)
    .run();

  const created = Number(recordResult.meta?.changes ?? 0) > 0;
  if (created) {
    await context.env.DB.prepare(
      'UPDATE frames SET view_count = view_count + 1 WHERE id = ?'
    )
      .bind(frameId)
      .run();
  }

  return actor;
}

async function recordFrameWear(context: EventContext<Env, string, unknown>, frameId: string) {
  const actor = await resolveGoodActor(context.env, context.request);
  const recordedAt = Date.now();

  await context.env.DB.prepare(
    `INSERT INTO frame_wear_events (id, frame_id, actor_type, actor_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), frameId, actor.actorType, actor.actorId, recordedAt)
    .run();

  await incrementFrameWearCount(context, frameId);

  return actor;
}

async function incrementFrameWearCount(context: EventContext<Env, string, unknown>, frameId: string) {
  await context.env.DB.prepare(
    'UPDATE frames SET wear_count = wear_count + 1 WHERE id = ?'
  )
    .bind(frameId)
    .run();
}

async function incrementFrameGoodCount(context: EventContext<Env, string, unknown>, frameId: string) {
  await context.env.DB.prepare(
    'UPDATE frames SET good_count = good_count + 1 WHERE id = ?'
  )
    .bind(frameId)
    .run();
}

function scheduleExpiredFrameCleanup(context: EventContext<Env, string, unknown>, frame: ResolvedFrame) {
  context.waitUntil(
    (async () => {
      try {
        await context.env.FRAMES_BUCKET.delete(frame.imageKey);
        if (frame.openingMaskKey) {
          await context.env.FRAMES_BUCKET.delete(frame.openingMaskKey);
        }
        await context.env.FRAMES_BUCKET.delete(`previews/${frame.frameId}.png`);
      } catch (err) {
        console.error('Failed to delete R2 object for expired frame:', err);
        return;
      }
      try {
        await context.env.DB.prepare('DELETE FROM frame_view_events WHERE frame_id = ?').bind(frame.frameId).run();
        await context.env.DB.prepare('DELETE FROM frame_wear_events WHERE frame_id = ?').bind(frame.frameId).run();
        await context.env.DB.prepare('DELETE FROM frame_views WHERE frame_id = ?').bind(frame.frameId).run();
        await context.env.DB.prepare('DELETE FROM frame_goods WHERE frame_id = ?').bind(frame.frameId).run();
        await context.env.DB.prepare('DELETE FROM share_urls WHERE frame_id = ?').bind(frame.frameId).run();
        await context.env.DB.prepare('DELETE FROM frames WHERE id = ?').bind(frame.frameId).run();
      } catch (err) {
        console.error('Failed to delete DB rows for expired frame:', err);
      }
    })()
  );
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const frame = await resolveFrame(context);

    if (!frame) {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    if (frame.expiresAt !== null && Date.now() > frame.expiresAt) {
      scheduleExpiredFrameCleanup(context, frame);
      return new Response('URL has expired', {
        status: 410,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    const requestUrl = new URL(context.request.url);
    const isMetaRequest = requestUrl.searchParams.get('meta') === '1';
    const isMaskRequest = requestUrl.searchParams.get('mask') === '1';
    const isOwnerDetailsRequest = requestUrl.searchParams.get('ownerDetails') === '1';
    const requiresPassword = Boolean(frame.passwordHash);
    const ownerAccess = requestUrl.searchParams.get('ownerPreview') === '1'
      ? await canOwnerAccessFrame(context, frame.ownerId)
      : false;
    const ownerDetailsAccess = isOwnerDetailsRequest
      ? await canOwnerAccessFrame(context, frame.ownerId)
      : false;
    const tokenAccess = await hasFrameAccess(context, frame.frameId);
    const accessGranted = !requiresPassword || ownerAccess || tokenAccess;

    if (isMetaRequest) {
      return json({
        requiresPassword,
        accessGranted,
        expiresAt: frame.expiresAt,
        hasOpeningMask: Boolean(frame.openingMaskKey),
      });
    }

    if (isOwnerDetailsRequest) {
      if (!ownerDetailsAccess) {
        return json({ error: 'FORBIDDEN' }, 403);
      }

      const share = await context.env.DB.prepare(
        'SELECT id FROM share_urls WHERE frame_id = ? ORDER BY created_at DESC LIMIT 1'
      )
        .bind(frame.frameId)
        .first<{ id: string }>();

      const shareUrl = share?.id
        ? `${requestUrl.origin}?f=${share.id}&openExternalBrowser=1`
        : frame.ownerId === null
          ? `${requestUrl.origin}?f=${frame.frameId}&openExternalBrowser=1`
          : null;

      const passwordValue = frame.passwordHash
        ? await decryptFramePassword(context.env, frame.passwordCiphertext)
        : null;

      return json({
        shareUrl,
        passwordProtected: requiresPassword,
        passwordValue,
      });
    }

    if (requiresPassword && !accessGranted) {
      return json({ error: 'PASSWORD_REQUIRED' }, 401);
    }

    if (isMaskRequest) {
      if (!frame.openingMaskKey) {
        return new Response('Not Found', {
          status: 404,
          headers: {
            'Cache-Control': 'no-store',
          },
        });
      }

      const object = await context.env.FRAMES_BUCKET.get(frame.openingMaskKey);

      if (object === null) {
        return new Response('Mask Not Found in Bucket', {
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

    const object = await context.env.FRAMES_BUCKET.get(frame.imageKey);

    if (object === null) {
      return new Response('Image Not Found in Bucket', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    const { customMetadata } = object;
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'no-store');
    headers.set(
      'X-Frame-Expires-At',
      frame.expiresAt !== null ? String(frame.expiresAt) : customMetadata?.expiresAt ? String(customMetadata.expiresAt) : 'none'
    );
    headers.set('X-Frame-Password-Required', requiresPassword ? '1' : '0');
    headers.set('Access-Control-Allow-Origin', '*');

    if (!ownerAccess) {
      const actor = await recordFrameView(context, frame.frameId);
      if (actor.setCookie) {
        headers.set('Set-Cookie', actor.setCookie);
      }
    }

    return new Response(object.body, {
      headers,
      status: 200,
    });
  } catch (error) {
    console.error('Fetch Error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const frame = await resolveFrame(context);

    if (!frame) {
      return json({ error: 'NOT_FOUND' }, 404);
    }

    if (frame.expiresAt !== null && Date.now() > frame.expiresAt) {
      scheduleExpiredFrameCleanup(context, frame);
      return json({ error: 'EXPIRED' }, 410);
    }

    const requestUrl = new URL(context.request.url);
    const isWearRequest = requestUrl.searchParams.get('wear') === '1';
    const isGoodRequest = requestUrl.searchParams.get('good') === '1';
    const requestOrigin = context.request.headers.get('Origin');

    if (isWearRequest) {
      if (frame.passwordHash) {
        const ownerAccess = await canOwnerAccessFrame(context, frame.ownerId);
        const tokenAccess = await hasFrameAccess(context, frame.frameId);

        if (!ownerAccess && !tokenAccess) {
          return json({ error: 'PASSWORD_REQUIRED' }, 401);
        }
      }

      const actor = await recordFrameWear(context, frame.frameId);
      const headers: HeadersInit | undefined = actor.setCookie
        ? { 'Set-Cookie': actor.setCookie }
        : undefined;

      return json({ ok: true }, 200, headers);
    }

    if (isGoodRequest) {
      const actor = await resolveGoodActor(context.env, context.request);
      const insertedAt = Date.now();
      const recordResult = await context.env.DB.prepare(
        `INSERT OR IGNORE INTO frame_goods (frame_id, actor_type, actor_id, created_at)
         VALUES (?, ?, ?, ?)`
      )
        .bind(frame.frameId, actor.actorType, actor.actorId, insertedAt)
        .run();

      const created = Number(recordResult.meta?.changes ?? 0) > 0;
      if (created) {
        await incrementFrameGoodCount(context, frame.frameId);
      }

      const headers: HeadersInit | undefined = actor.setCookie
        ? {
            'Set-Cookie': actor.setCookie,
            ...(requestOrigin
              ? {
                  'Access-Control-Allow-Origin': requestOrigin,
                  'Access-Control-Allow-Credentials': 'true',
                  Vary: 'Origin',
                }
              : {}),
          }
        : requestOrigin
          ? {
              'Access-Control-Allow-Origin': requestOrigin,
              'Access-Control-Allow-Credentials': 'true',
              Vary: 'Origin',
            }
          : undefined;

      return json({ ok: true, created }, 200, headers);
    }

    if (!frame.passwordHash) {
      return json({ ok: true, requiresPassword: false });
    }

    const body = await context.request.json().catch(() => ({} as { password?: unknown }));
    const password = typeof body.password === 'string' ? body.password.trim() : '';

    if (!password) {
      return json({ error: 'MISSING_PASSWORD' }, 400);
    }

    const submittedHash = await hashFramePassword(password);
    if (submittedHash !== frame.passwordHash) {
      return json({ error: 'INVALID_PASSWORD' }, 401);
    }

    const accessToken = await createFrameAccessToken(context.env, frame.frameId);
    if (!accessToken) {
      return json({ error: 'ACCESS_TOKEN_UNAVAILABLE' }, 500);
    }

    return json({ ok: true, requiresPassword: true, accessToken });
  } catch (error) {
    console.error('Password verification failed:', error);
    return json({ error: 'INTERNAL_SERVER_ERROR' }, 500);
  }
};
