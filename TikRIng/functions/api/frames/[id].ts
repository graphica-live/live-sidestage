import type { Env } from '../../_types';
import { getSession } from '../../_session';
import { createFrameAccessToken, hashFramePassword, verifyFrameAccessToken } from '../../_framePassword';
import { isAdminEmail } from '../../_auth';

type ShareRow = {
  frame_id: string;
};

type FrameRow = {
  id: string;
  owner_id: string | null;
  image_key: string;
  expires_at: number | null;
  password_hash: string | null;
};

type ResolvedFrame = {
  frameId: string;
  ownerId: string | null;
  imageKey: string;
  expiresAt: number | null;
  passwordHash: string | null;
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
    'SELECT id, owner_id, image_key, expires_at, password_hash FROM frames WHERE id = ?'
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
    expiresAt: frameRow.expires_at ?? null,
    passwordHash: frameRow.password_hash ?? null,
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

function scheduleExpiredFrameCleanup(context: EventContext<Env, string, unknown>, frame: ResolvedFrame) {
  context.waitUntil(
    (async () => {
      try {
        await context.env.FRAMES_BUCKET.delete(frame.imageKey);
      } catch (err) {
        console.error('Failed to delete R2 object for expired frame:', err);
        return;
      }
      try {
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
    const requiresPassword = Boolean(frame.passwordHash);
    const ownerAccess = requestUrl.searchParams.get('ownerPreview') === '1'
      ? await canOwnerAccessFrame(context, frame.ownerId)
      : false;
    const tokenAccess = await hasFrameAccess(context, frame.frameId);
    const accessGranted = !requiresPassword || ownerAccess || tokenAccess;

    if (requestUrl.searchParams.get('meta') === '1') {
      return json({
        requiresPassword,
        accessGranted,
        expiresAt: frame.expiresAt,
      });
    }

    if (requiresPassword && !accessGranted) {
      return json({ error: 'PASSWORD_REQUIRED' }, 401);
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
