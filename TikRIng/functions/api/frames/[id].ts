export interface Env {
  FRAMES_BUCKET: R2Bucket;
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    // パスパラメータからUUIDを取得
    // 例: /api/frames/1234-abcd -> params.id is "1234-abcd"
    let id = context.params.id as string;

    if (!id) {
      return new Response('Not Found', { status: 404 });
    }

    // share_urlsテーブルで共有トークンを解決
    const shareRow = await context.env.DB.prepare(
      'SELECT id, frame_id FROM share_urls WHERE id = ?'
    ).bind(id).first<{ id: string; frame_id: string }>();

    if (shareRow) {
      // idがshare_urlsのトークンの場合
      // R2取得のためにframe_idに差し替え
      id = shareRow.frame_id;
    }

    // DBから有効期限をチェック（expires_at を正とする）
    const frameRow = await context.env.DB.prepare(
      'SELECT id, expires_at FROM frames WHERE id = ?'
    )
      .bind(id)
      .first<{ id: string; expires_at: number | null }>();

    const expiresAtMs = frameRow?.expires_at ?? null;

    if (expiresAtMs !== null && Date.now() > expiresAtMs) {
      // 期限切れ: R2から物理削除 + DBも掃除（非同期で実行）
      context.waitUntil(
        Promise.all([
          context.env.FRAMES_BUCKET.delete(id),
          context.env.DB.prepare('DELETE FROM share_urls WHERE frame_id = ?').bind(id).run(),
          context.env.DB.prepare('DELETE FROM frames WHERE id = ?').bind(id).run(),
        ])
      );

      return new Response('URL has expired', { status: 410 });
    }

    // R2からオブジェクトを取得
    const object = await context.env.FRAMES_BUCKET.get(id);

    if (object === null) {
      return new Response('Image Not Found in Bucket', { status: 404 });
    }

    const { customMetadata } = object;

    // キャッシュやCORSヘッダーを設定してレスポンスを返す
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    // 期限切れ判定を確実にするため、キャッシュはしない（エッジ/ブラウザの長期キャッシュがあると410にならない）
    headers.set('Cache-Control', 'no-store');

    // リスナー画面表示用: 有効期限(Unix ms)をヘッダーで返す（無期限は 'none'）
    headers.set(
      'X-Frame-Expires-At',
      expiresAtMs !== null ? String(expiresAtMs) : customMetadata?.expiresAt ? String(customMetadata.expiresAt) : 'none'
    );

    // 他のドメインからの利用も許可する場合 (Canvasのtainted対策)
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
