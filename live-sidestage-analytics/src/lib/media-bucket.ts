// Railway Bucket(S3互換)への接続クライアント。web/worker両方から使う共有モジュール。
//
// S3Client/getSignedUrlはNode.jsで完結しNext.js依存が無いため、workerプロセスからの
// 直接利用も問題ない(workerは既にPrisma DB書き込み・TikTok Webcastへの外部通信を直接
// 行っており、S3への直接アップロードも同種の外部I/O)。

import { S3Client } from "@aws-sdk/client-s3";

let cached: { client: S3Client; bucket: string } | null | undefined;

export function getMediaBucketClient(): { client: S3Client; bucket: string } | null {
  if (cached !== undefined) return cached;

  const endpoint = process.env.MEDIA_BUCKET_ENDPOINT;
  const region = process.env.MEDIA_BUCKET_REGION;
  const bucket = process.env.MEDIA_BUCKET_NAME;
  const accessKeyId = process.env.MEDIA_BUCKET_ACCESS_KEY_ID;
  const secretAccessKey = process.env.MEDIA_BUCKET_SECRET_ACCESS_KEY;

  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    cached = null;
    return null;
  }

  cached = {
    bucket,
    client: new S3Client({
      endpoint,
      region,
      // Railway Bucket credentials の urlStyle は "virtual-host"(<bucket>.<host>)。
      forcePathStyle: false,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
  return cached;
}
