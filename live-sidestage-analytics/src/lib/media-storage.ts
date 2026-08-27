// イベントのカバー画像を置く Railway Bucket(S3互換、railway bucket credentials で取得)への
// アクセス。presigned PUTでブラウザから直接アップロードさせるフロー自体はwebページ専用だが、
// クライアント生成(media-bucket.ts)自体はweb/worker共有(avatar-storage.tsもworkerから使う)。
//
// 生の画像URLはDBに保存しない。オブジェクトキーだけ保存し(Event.coverImageKey)、
// 読み出しのたびに presigned GET を発行する。ページはどれも force-dynamic なので
// リクエストごとの署名生成で問題ない(署名はローカル演算、ネットワーク往復は無い)。

import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ALLOWED_COVER_CONTENT_TYPES, MAX_COVER_IMAGE_BYTES } from "@/event/cover-key";
import { getMediaBucketClient } from "./media-bucket";

const UPLOAD_URL_TTL_SECONDS = 300; // 5分。ブラウザが直後にPUTする前提
const READ_URL_TTL_SECONDS = 3600; // 1時間。force-dynamicなので都度再発行で足りる

function getClient() {
  return getMediaBucketClient();
}

export function isCoverUploadEnabled(): boolean {
  return getClient() !== null;
}

/** 主催者からのアップロード用 presigned PUT URL。DBは触らない(確定は呼び出し側の別ステップ)。 */
export async function createCoverUploadUrl(
  key: string,
  contentType: string,
  size: number
): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  const storage = getClient();
  if (!storage) return { ok: false, error: "画像アップロードは現在利用できない。" };

  if (!ALLOWED_COVER_CONTENT_TYPES.includes(contentType)) {
    return { ok: false, error: "画像形式はJPEG/PNG/WebPのみ対応している。" };
  }
  if (!Number.isInteger(size) || size <= 0 || size > MAX_COVER_IMAGE_BYTES) {
    return { ok: false, error: `画像サイズは${MAX_COVER_IMAGE_BYTES / 1024 / 1024}MB以内にしてください。` };
  }

  // ContentLength を署名に含め、宣言したサイズと違うPUTを拒否させる。ただし
  // S3互換実装がこれを必ず強制する保証は無いため、確定側(PATCH)でも
  // HeadObjectで実際のサイズ・Content-Typeを再検証する(信頼の起点はそちら)。
  const command = new PutObjectCommand({
    Bucket: storage.bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: size,
  });
  const uploadUrl = await getSignedUrl(storage.client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
  return { ok: true, uploadUrl };
}

/**
 * アップロード確定前の検証。オブジェクトが実在し、型・サイズが許容範囲内かを
 * HeadObjectで確認する(presigned PUT のContentLength指定だけでは強制を信頼できないため)。
 */
export async function verifyCoverObject(
  key: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const storage = getClient();
  if (!storage) return { ok: false, error: "画像アップロードは現在利用できない。" };

  let head;
  try {
    head = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key }));
  } catch {
    return { ok: false, error: "アップロードされた画像が見つからない。" };
  }

  if (!head.ContentType || !ALLOWED_COVER_CONTENT_TYPES.includes(head.ContentType)) {
    return { ok: false, error: "画像形式が不正。" };
  }
  if (typeof head.ContentLength !== "number" || head.ContentLength > MAX_COVER_IMAGE_BYTES) {
    return { ok: false, error: "画像サイズが上限を超えている。" };
  }
  return { ok: true };
}

/** ベストエフォート削除。失敗しても呼び出し側の主処理は継続してよい。 */
export async function deleteCoverObject(key: string): Promise<void> {
  const storage = getClient();
  if (!storage) return;
  try {
    await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }));
  } catch {
    // 孤児オブジェクトが1つ残るだけ。呼び出し側の保存/削除自体は失敗させない。
  }
}

/** 公開ページ/編集ページの表示用 presigned GET URL。keyがnullならnull。 */
export async function getCoverImageUrl(key: string | null): Promise<string | null> {
  if (!key) return null;
  const storage = getClient();
  if (!storage) return null;

  const command = new GetObjectCommand({ Bucket: storage.bucket, Key: key });
  return getSignedUrl(storage.client, command, { expiresIn: READ_URL_TTL_SECONDS });
}
