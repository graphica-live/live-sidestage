import { getSession } from '../_session';

export interface Env {
  FRAMES_BUCKET: R2Bucket;
  DB: D1Database;
  SESSIONS: KVNamespace;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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

    const customNameRaw = formData.get('customName');
    const expiresAtRaw = formData.get('expiresAt');
    const passwordRaw = formData.get('password');

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
    const ownerId = session?.userId ?? null;

    let plan: string | null = null;
    if (session) {
      const user = await context.env.DB.prepare(
        'SELECT plan FROM users WHERE id = ?'
      ).bind(session.userId).first<{ plan: string }>();
      plan = user?.plan ?? null;

      if (plan === 'free') {
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

    const nowMs = Date.now();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

    const isPro = plan === 'pro';

    // expires_at: Proは指定があればそれ、なければNULL(無期限)。Pro以外は常に90日固定
    let expiresAtMs: number | null = null;
    if (isPro) {
      if (typeof expiresAtRaw === 'string' && expiresAtRaw.trim()) {
        const parsed = Number(expiresAtRaw);
        if (Number.isFinite(parsed)) {
          expiresAtMs = Math.trunc(parsed);
        }
      }
    } else {
      expiresAtMs = nowMs + ninetyDaysMs;
    }

    // custom_name: Proのみ
    const customName =
      isPro && typeof customNameRaw === 'string' && customNameRaw.trim() ? customNameRaw.trim() : null;

    // password_hash: Proのみ（入力があればSHA-256）
    let passwordHash: string | null = null;
    if (isPro && typeof passwordRaw === 'string' && passwordRaw.trim()) {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(passwordRaw.trim())
      );
      passwordHash = bytesToHex(digest);
    }

    // R2に保存 (ファイル名をUUIDにする)
    const customMetadata: Record<string, string> = {};
    if (expiresAtMs !== null) {
      customMetadata.expiresAt = String(expiresAtMs);
    }

    await context.env.FRAMES_BUCKET.put(uuid, arrayBuffer, {
      httpMetadata: { contentType: 'image/png' },
      customMetadata: Object.keys(customMetadata).length ? customMetadata : undefined,
    });

    // D1のframesテーブルに登録
    await context.env.DB.prepare(
      'INSERT INTO frames (id, owner_id, image_key, created_at, custom_name, expires_at, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(uuid, ownerId, uuid, nowMs, customName, expiresAtMs, passwordHash).run();

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
