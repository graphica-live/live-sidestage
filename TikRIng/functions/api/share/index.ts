import type { Env } from '../../_types';
import { getSession } from '../../_session';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const session = await getSession(ctx.env, ctx.request);
  const { frameId } = await ctx.request.json<{ frameId: string }>();

  if (!frameId) {
    return new Response(JSON.stringify({ error: 'frameId is required' }), { status: 400 });
  }

  // フレームの存在確認（owner確認はログイン時のみ）
  let frame;
  if (session) {
    frame = await ctx.env.DB.prepare(
      'SELECT id, owner_id FROM frames WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)'
    ).bind(frameId, session.userId).first();
  } else {
    frame = await ctx.env.DB.prepare(
      'SELECT id, owner_id FROM frames WHERE id = ? AND owner_id IS NULL'
    ).bind(frameId).first();
  }

  if (!frame) {
    return new Response(JSON.stringify({ error: 'Frame not found' }), { status: 404 });
  }

  // プランによって上限を決定
  let maxAccess: number | null = 30; // 未ログインデフォルト
  if (session) {
    const user = await ctx.env.DB.prepare(
      'SELECT plan FROM users WHERE id = ?'
    ).bind(session.userId).first<{ plan: string }>();

    maxAccess = user?.plan === 'pro' ? null : 300;
  }

  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 12);

  await ctx.env.DB.prepare(
    'INSERT INTO share_urls (id, frame_id, access_count, max_access, created_at) VALUES (?, ?, 0, ?, ?)'
  ).bind(token, frameId, maxAccess, Date.now()).run();

  const siteUrl = new URL(ctx.request.url).origin;
  const url = `${siteUrl}?f=${token}&openExternalBrowser=1`;

  return new Response(JSON.stringify({ token, url }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
