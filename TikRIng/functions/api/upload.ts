export interface Env {
  FRAMES_BUCKET: R2Bucket;
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

    // ファイル形式の簡易検証
    if (!file.type.startsWith('image/')) {
      return new Response(JSON.stringify({ error: 'Invalid file type' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // UUID (v4相当) を生成
    const uuid = crypto.randomUUID();
    
    // R2に保存 (ファイル名をUUIDにする)
    const arrayBuffer = await file.arrayBuffer();
    await context.env.FRAMES_BUCKET.put(uuid, arrayBuffer, {
      httpMetadata: { contentType: file.type },
    });

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
