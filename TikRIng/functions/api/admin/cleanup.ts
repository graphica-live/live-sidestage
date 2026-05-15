import type { Env } from '../../_types';

function unauthorized() {
  return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const token = context.env.CLEANUP_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ error: 'CLEANUP_TOKEN_NOT_SET' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = context.request.headers.get('authorization') ?? '';
  const expected = `Bearer ${token}`;
  if (auth !== expected) return unauthorized();

  const url = new URL(context.request.url);
  const limitRaw = url.searchParams.get('limit');
  const limit = Math.max(1, Math.min(500, Number(limitRaw ?? '100') || 100));

  const nowMs = Date.now();

  // Get top 10 frame IDs by wear_count for ranking protection
  const top10Rows = await context.env.DB.prepare(
    'SELECT id FROM frames WHERE COALESCE(exclude_from_rankings, 0) = 0 ORDER BY COALESCE(wear_count, 0) DESC, created_at DESC LIMIT 10'
  ).all<{ id: string }>();
  const top10Ids = new Set((top10Rows.results ?? []).map((r) => r.id));

  // 現在のtop10を ever_top10=1 としてマーク（一度でもtop10入りしたフレームを恒久保全）
  if (top10Ids.size > 0) {
    const placeholders = Array.from(top10Ids).map(() => '?').join(', ');
    await context.env.DB.prepare(
      `UPDATE frames SET ever_top10 = 1 WHERE id IN (${placeholders}) AND ever_top10 = 0`
    ).bind(...Array.from(top10Ids)).run();
  }

  const rows = await context.env.DB.prepare(
    'SELECT id, image_key, ever_top10 FROM frames WHERE expires_at IS NOT NULL AND expires_at < ? ORDER BY expires_at ASC LIMIT ?'
  )
    .bind(nowMs, limit)
    .all<{ id: string; image_key: string; ever_top10: number }>();

  const expired = rows.results ?? [];

  let deletedR2 = 0;
  let deletedDb = 0;
  let protectedCount = 0;
  const failures: Array<{ id: string; step: string }> = [];

  for (const row of expired) {
    // ever_top10=1 または現在のtop10フレーム: share URLのみ無効化、データは完全保全
    if (row.ever_top10 === 1 || top10Ids.has(row.id)) {
      try {
        await context.env.DB.prepare('DELETE FROM share_urls WHERE frame_id = ?').bind(row.id).run();
        protectedCount += 1;
      } catch {
        failures.push({ id: row.id, step: 'share_url_invalidate' });
      }
      continue;
    }

    try {
      await context.env.FRAMES_BUCKET.delete(row.image_key);
      deletedR2 += 1;
    } catch {
      failures.push({ id: row.id, step: 'r2_delete' });
      continue;
    }

    try {
      await context.env.DB.prepare('DELETE FROM frame_wears WHERE frame_id = ?').bind(row.id).run();
      await context.env.DB.prepare('DELETE FROM frame_goods WHERE frame_id = ?').bind(row.id).run();
      await context.env.DB.prepare('DELETE FROM share_urls WHERE frame_id = ?').bind(row.id).run();
      await context.env.DB.prepare('DELETE FROM frames WHERE id = ?').bind(row.id).run();
      deletedDb += 1;
    } catch {
      failures.push({ id: row.id, step: 'db_delete' });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      scanned: expired.length,
      deletedR2,
      deletedDb,
      protected: protectedCount,
      failures,
      nowMs,
      limit,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};
