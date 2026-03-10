export interface Env {
  FRAMES_BUCKET: R2Bucket;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    // パスパラメータからUUIDを取得
    // 例: /api/frames/1234-abcd -> params.id is "1234-abcd"
    const id = context.params.id as string;

    if (!id) {
      return new Response('Not Found', { status: 404 });
    }

    // R2からオブジェクトを取得
    const object = await context.env.FRAMES_BUCKET.get(id);

    if (object === null) {
      return new Response('Image Not Found in Bucket', { status: 404 });
    }

    // メタデータから有効期限をチェック
    const { customMetadata } = object;
    if (customMetadata && customMetadata.expiresAt) {
      const expiresAt = parseInt(customMetadata.expiresAt, 10);

      // 現在時刻が有効期限を過ぎている場合
      if (Date.now() > expiresAt) {
        // R2から物理削除（非同期で実行させてレスポンスをブロックしない）
        context.waitUntil(context.env.FRAMES_BUCKET.delete(id));

        return new Response('URL has expired', { status: 410 }); // 410 Gone (消滅した)
      }
    }

    // キャッシュやCORSヘッダーを設定してレスポンスを返す
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    // デモ用: 1年間キャッシュ
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');

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
