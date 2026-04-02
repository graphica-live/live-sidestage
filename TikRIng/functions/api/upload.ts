import { getSession } from '../_session';
import { encryptFramePassword, hashFramePassword } from '../_framePassword';
import type { Env } from '../_types';
import { isEffectivePro } from '../_auth';

type RecaptchaVerifyResponse = {
  score?: number;
};

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
    const openingMaskFile = formData.get('openingMask') as File | null;
    const sharePreviewFile = formData.get('sharePreview') as File | null;

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

    let openingMaskArrayBuffer: ArrayBuffer | null = null;
    if (openingMaskFile) {
      if (openingMaskFile.type !== 'image/png') {
        return new Response(JSON.stringify({ error: 'Only PNG mask files are allowed' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const MAX_MASK_SIZE = 1024 * 1024;
      if (openingMaskFile.size > MAX_MASK_SIZE) {
        return new Response(JSON.stringify({ error: 'Mask file size exceeds limit' }), {
          status: 413,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      openingMaskArrayBuffer = await openingMaskFile.arrayBuffer();
      if (!isPngSignature(new Uint8Array(openingMaskArrayBuffer))) {
        return new Response(JSON.stringify({ error: 'Invalid PNG mask file' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    let sharePreviewArrayBuffer: ArrayBuffer | null = null;
    if (sharePreviewFile) {
      if (sharePreviewFile.type !== 'image/png') {
        return new Response(JSON.stringify({ error: 'Only PNG preview files are allowed' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const MAX_PREVIEW_SIZE = 2 * 1024 * 1024;
      if (sharePreviewFile.size > MAX_PREVIEW_SIZE) {
        return new Response(JSON.stringify({ error: 'Preview file size exceeds limit' }), {
          status: 413,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      sharePreviewArrayBuffer = await sharePreviewFile.arrayBuffer();
      if (!isPngSignature(new Uint8Array(sharePreviewArrayBuffer))) {
        return new Response(JSON.stringify({ error: 'Invalid PNG preview file' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // reCAPTCHA v3 (tokenがある場合のみ検証。失敗しても続行してアップロードを阻害しない)
    const recaptchaTokenRaw = formData.get('recaptchaToken');
    if (typeof recaptchaTokenRaw === 'string' && recaptchaTokenRaw.trim() && context.env.RECAPTCHA_SECRET_KEY) {
      try {
        const body = new URLSearchParams({
          secret: context.env.RECAPTCHA_SECRET_KEY,
          response: recaptchaTokenRaw.trim(),
        });

        const verifyRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });

        if (verifyRes.ok) {
          const verifyData = (await verifyRes.json()) as RecaptchaVerifyResponse;
          const score = typeof verifyData?.score === 'number' ? verifyData.score : null;
          if (score !== null && score < 0.5) {
            return new Response(JSON.stringify({ error: 'BOT_DETECTED', message: '不正なアクセスを検出しました。' }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
      } catch (err) {
        console.warn('reCAPTCHA verify failed (ignored):', err);
      }
    }

    // ログインユーザーのプラン取得
    const session = await getSession(context.env, context.request);
    const ownerId = session?.userId ?? null;

    let plan: string | null = null;
    let email: string | null = null;
    if (session) {
      const user = await context.env.DB.prepare(
        'SELECT plan, email FROM users WHERE id = ?'
      ).bind(session.userId).first<{ plan: string; email: string | null }>();
      plan = user?.plan ?? null;
      email = user?.email ?? null;
    }

    // UUID (v4相当) を生成
    const uuid = crypto.randomUUID();

    const nowMs = Date.now();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

    const isPro = isEffectivePro(plan, email);

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

    // custom_name: Proのみ（未入力ならアップロード時のファイル名を使用）
    let customName =
      isPro && typeof customNameRaw === 'string' && customNameRaw.trim() ? customNameRaw.trim() : null;
    if (isPro && !customName) {
      const baseName = file.name?.replace(/\.[^/.]+$/, '').trim();
      if (baseName) customName = baseName;
    }

    // password_hash: Proのみ（入力があればSHA-256）
    let passwordHash: string | null = null;
    let passwordCiphertext: string | null = null;
    if (isPro && typeof passwordRaw === 'string' && passwordRaw.trim()) {
      const normalizedPassword = passwordRaw.trim();
      passwordHash = await hashFramePassword(normalizedPassword);
      passwordCiphertext = await encryptFramePassword(context.env, normalizedPassword);
    }

    // R2に保存 (ファイル名をUUIDにする)
    const customMetadata: Record<string, string> = {};
    if (expiresAtMs !== null) {
      customMetadata.expiresAt = String(expiresAtMs);
    }

    const openingMaskKey = openingMaskArrayBuffer ? `masks/${uuid}.png` : null;
    const sharePreviewKey = sharePreviewArrayBuffer ? `previews/${uuid}.png` : null;

    await context.env.FRAMES_BUCKET.put(uuid, arrayBuffer, {
      httpMetadata: { contentType: 'image/png' },
      customMetadata: Object.keys(customMetadata).length ? customMetadata : undefined,
    });

    if (openingMaskArrayBuffer && openingMaskKey) {
      await context.env.FRAMES_BUCKET.put(openingMaskKey, openingMaskArrayBuffer, {
        httpMetadata: { contentType: 'image/png' },
      });
    }

    if (sharePreviewArrayBuffer && sharePreviewKey) {
      await context.env.FRAMES_BUCKET.put(sharePreviewKey, sharePreviewArrayBuffer, {
        httpMetadata: { contentType: 'image/png' },
      });
    }

    // D1のframesテーブルに登録
    await context.env.DB.prepare(
      'INSERT INTO frames (id, owner_id, image_key, created_at, custom_name, expires_at, password_hash, password_ciphertext, opening_mask_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(uuid, ownerId, uuid, nowMs, customName, expiresAtMs, passwordHash, passwordCiphertext, openingMaskKey).run();

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
