import { getSession } from '../_session';

export interface Env {
  FRAMES_BUCKET: R2Bucket;
  DB: D1Database;
  SESSIONS: KVNamespace;
}

function isPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const request = context.request;
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // PNGファイルのみ許可
    if (file.type !== 'image/png') {
      return new Response(JSON.stringify({ error: 'Only PNG files are allowed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ファイルサイズの検証 (5MB = 5 * 1024 * 1024 bytes)
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return new Response(JSON.stringify({ error: 'File size exceeds 5MB limit' }), {
        status: 413, // 413 Payload Too Large
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const arrayBuffer = await file.arrayBuffer();
    if (!isPngSignature(new Uint8Array(arrayBuffer))) {
      return new Response(JSON.stringify({ error: 'Invalid PNG file' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ログインユーザーかつ無料プランの場合、フレーム数制限チェック
    const session = await getSession(context.env, context.request);
    if (session) {
      const user = await context.env.DB.prepare(
        'SELECT plan FROM users WHERE id = ?'
      ).bind(session.userId).first<{ plan: string }>();

      if (user?.plan === 'free') {
        const count = await context.env.DB.prepare(
          'SELECT COUNT(*) as cnt FROM frames WHERE owner_id = ?'
        ).bind(session.userId).first<{ cnt: number }>();

        if ((count?.cnt ?? 0) >= 1) {
          return new Response(JSON.stringify({ error: 'FREE_PLAN_LIMIT', message: 'Proプランにアップグレードするとフレームを複数登録できます。' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // UUID (v4相当) を生成
    const uuid = crypto.randomUUID();

    // 90日後のタイムスタンプ（ミリ秒）を計算
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const expiresAt = (Date.now() + ninetyDaysMs).toString();

    // R2に保存 (ファイル名をUUIDにする)
    await context.env.FRAMES_BUCKET.put(uuid, arrayBuffer, {
      httpMetadata: { contentType: 'image/png' },
      customMetadata: { expiresAt }, // 削除チェック用のメタデータを追加
    });

    // D1のframesテーブルに登録
    const ownerId = session?.userId ?? null;
    await context.env.DB.prepare(
      'INSERT INTO frames (id, owner_id, image_key, created_at) VALUES (?, ?, ?, ?)'
    ).bind(uuid, ownerId, uuid, Date.now()).run();

    return new Response(JSON.stringify({ id: uuid }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Upload Error:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
