import type { Env } from '../../_types';

function unauthorized() {
  return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

// frames を参照する FK を持つ子テーブル。ここに漏れがあると D1 が FK 違反で
// 親の DELETE を拒否するため、フレームが消えずに残る。
// FK 定義: migrations/0008(frame_goods), 0011(frame_views), 0012(frame_view_events,
// frame_wear_events), 0016(frame_wears), 0001(share_urls)
const CHILD_TABLES = [
  'frame_wears',
  'frame_goods',
  'frame_views',
  'frame_view_events',
  'frame_wear_events',
  'share_urls',
] as const;

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
    'SELECT id, image_key, opening_mask_key, ever_top10 FROM frames WHERE expires_at IS NOT NULL AND expires_at < ? ORDER BY expires_at ASC LIMIT ?'
  )
    .bind(nowMs, limit)
    .all<{ id: string; image_key: string; opening_mask_key: string | null; ever_top10: number }>();

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

    // D1 を先に消す。R2 の削除は不可逆なので、DB 側の削除が確定してから行う。
    // 逆順（従来の実装）だと、子テーブルの FK 違反で frames の DELETE が失敗したときに
    // 「画像だけ消えて DB 行が残る」壊れたフレームができる。
    try {
      const statements = [
        ...CHILD_TABLES.map((table) =>
          context.env.DB.prepare(`DELETE FROM ${table} WHERE frame_id = ?`).bind(row.id)
        ),
        context.env.DB.prepare('DELETE FROM frames WHERE id = ?').bind(row.id),
      ];
      // batch() は一連の文を単一トランザクションで実行する
      await context.env.DB.batch(statements);
      deletedDb += 1;
    } catch (err) {
      console.error('Cleanup DB delete failed', { frameId: row.id, error: err });
      failures.push({ id: row.id, step: 'db_delete' });
      continue;
    }

    // DB から消えた以上、R2 の残骸は参照されない。失敗しても孤児オブジェクトが残るだけで、
    // 壊れたフレームにはならない（次回以降のスイープで回収できる）。
    try {
      await context.env.FRAMES_BUCKET.delete(row.image_key);
      if (row.opening_mask_key) {
        await context.env.FRAMES_BUCKET.delete(row.opening_mask_key);
      }
      await context.env.FRAMES_BUCKET.delete(`previews/${row.id}.png`);
      deletedR2 += 1;
    } catch (err) {
      console.error('Cleanup R2 delete failed', { frameId: row.id, error: err });
      failures.push({ id: row.id, step: 'r2_delete' });
    }
  }

  // 部分失敗を 200 で返すと GitHub Actions が成功扱いにして気付けない。
  const ok = failures.length === 0;

  return new Response(
    JSON.stringify({
      ok,
      scanned: expired.length,
      deletedR2,
      deletedDb,
      protected: protectedCount,
      failures,
      nowMs,
      limit,
    }),
    {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};
