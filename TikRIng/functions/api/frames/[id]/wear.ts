import type { Env } from '../../../_types';
import { getSession } from '../../../_session';
import { verifyFrameAccessToken } from '../../../_framePassword';
import { isAdminEmail } from '../../../_auth';

type ShareRow = {
  frame_id: string;
};

type FrameRow = {
  id: string;
  owner_id: string | null;
  expires_at: number | null;
  password_hash: string | null;
};

type ResolvedFrame = {
  frameId: string;
  ownerId: string | null;
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
    'SELECT id, owner_id, expires_at, password_hash FROM frames WHERE id = ?'
  )
    .bind(id)
    .first<FrameRow>();

  if (!frameRow) {
    return null;
  }

  return {
    frameId: frameRow.id,
    ownerId: frameRow.owner_id,
    expiresAt: frameRow.expires_at ?? null,
    passwordHash: frameRow.password_hash ?? null,
  };
}

async function hasFrameAccess(context: EventContext<Env, string, unknown>, frameId: string) {
  const accessToken = new URL(context.request.url).searchParams.get('accessToken');
  return verifyFrameAccessToken(context.env, accessToken, frameId);
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

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const frame = await resolveFrame(context);

    if (!frame) {
      return json({ error: 'NOT_FOUND' }, 404);
    }

    if (frame.expiresAt !== null && Date.now() > frame.expiresAt) {
      return json({ error: 'EXPIRED' }, 410);
    }

    if (frame.passwordHash) {
      const ownerAccess = await canOwnerAccessFrame(context, frame.ownerId);
      const tokenAccess = await hasFrameAccess(context, frame.frameId);

      if (!ownerAccess && !tokenAccess) {
        return json({ error: 'PASSWORD_REQUIRED' }, 401);
      }
    }

    await context.env.DB.prepare(
      'UPDATE frames SET wear_count = wear_count + 1 WHERE id = ?'
    )
      .bind(frame.frameId)
      .run();

    return json({ ok: true });
  } catch (error) {
    console.error('Wear count update failed:', error);
    return json({ error: 'INTERNAL_SERVER_ERROR' }, 500);
  }
};