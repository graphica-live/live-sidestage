import type { Env } from '../../../_types';

type ShareRow = {
  frame_id: string;
};

type FrameRow = {
  id: string;
  image_key: string;
  expires_at: number | null;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const id = context.params.id as string;

    if (!id) {
      return new Response('Not Found', { status: 404 });
    }

    const shareRow = await context.env.DB.prepare(
      'SELECT frame_id FROM share_urls WHERE id = ?'
    ).bind(id).first<ShareRow>();

    if (!shareRow?.frame_id) {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    const frameRow = await context.env.DB.prepare(
      'SELECT id, image_key, expires_at FROM frames WHERE id = ?'
    ).bind(shareRow.frame_id).first<FrameRow>();

    if (!frameRow) {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    if (frameRow.expires_at !== null && Date.now() > frameRow.expires_at) {
      return new Response('Gone', {
        status: 410,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    const object = await context.env.FRAMES_BUCKET.get(frameRow.image_key);

    if (!object) {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', 'image/png');
    headers.set('Cache-Control', 'public, max-age=3600');
    headers.set('X-Robots-Tag', 'noindex');

    return new Response(object.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('Share thumbnail fetch failed:', error);
    return new Response('Internal Server Error', {
      status: 500,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }
};