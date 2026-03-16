import type { Env } from '../_types';

export const onRequestGet: PagesFunction<Env> = async () => {
  return new Response(
    JSON.stringify({ ok: true, ts: Date.now() }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
};
