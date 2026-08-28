// TikTok(バトル参加者・ギフト送信者)のアバター画像を自前ストレージへ恒久保存するキャッシュ。
//
// TikTokのavatar URL(anchorInfo.avatarThumb / gift.profilePictureUrl)は署名付きで
// 数十時間~で失効する。ここでは元のURLをDBへ保存せず、画像バイトを取得・圧縮して
// Railway Bucketへ置き、DB(TiktokAvatarAsset)にはオブジェクトキーだけを持つ。
//
// web/worker両方から呼ばれる。worker側(gift/battleイベント受信の都度)は必ず
// fire-and-forgetで呼ぶこと — saveGift/saveComboGiftのadvisory lock保持時間に
// 影響させてはならない。

import sharp from "sharp";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "@/lib/prisma";
import { getMediaBucketClient } from "./media-bucket";
import { buildAvatarKey, type AvatarKind } from "./avatar-key";
import { isAllowedAvatarUrl } from "./tiktok-profile";

const READ_URL_TTL_SECONDS = 24 * 60 * 60; // 24時間。公開度の低い小画像で、バトルタブは非ライブ中ポーリングしないため長め
const REFETCH_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30日超で再取得(TikTokユーザーはアイコンを変更するため)

const FETCH_TIMEOUT_MS = 8000;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

const OUTPUT_CONTENT_TYPE = "image/webp";
const OUTPUT_MAX_EDGE = 128;
const OUTPUT_QUALITY = 70;

/** 同時に投げる外向きダウンロード数の上限。tiktok-avatar.tsのMAX_CONCURRENCYと同じ考え方。 */
const MAX_CONCURRENCY = 4;
/** 待機キューの上限。画像ダウンロードはJSON取得よりコストが高いため、溢れたら諦める。 */
const MAX_WAITING = 50;

const CIRCUIT_THRESHOLD = 8;
const CIRCUIT_OPEN_MS = 5 * 60 * 1000;

let running = 0;
const waiting: (() => void)[] = [];
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

/**
 * 直近に試行済みのsubjectIdを24時間覚えておき、重複ダウンロードを避ける。
 * 記録するのは実際にfetchを実行した場合(成功・確定失敗いずれも)のみ。waitingキュー
 * 上限超過やサーキットブレーカーで実行自体を見送った場合は記録しない
 * (記録するとバズ配信で新規送信者のアイコンが24時間再試行されなくなる)。
 */
const THROTTLE_TTL_MS = 24 * 60 * 60 * 1000;
const THROTTLE_MAX_ENTRIES = 2000;
const throttled = new Map<string, number /* expiresAt */>();

function throttleKey(kind: AvatarKind, subjectId: string): string {
  return `${kind}:${subjectId}`;
}

function isThrottled(key: string, now: number): boolean {
  const expiresAt = throttled.get(key);
  if (expiresAt === undefined) return false;
  if (expiresAt <= now) {
    throttled.delete(key);
    return false;
  }
  return true;
}

function markThrottled(key: string, now: number): void {
  throttled.delete(key);
  throttled.set(key, now + THROTTLE_TTL_MS);
  while (throttled.size > THROTTLE_MAX_ENTRIES) {
    const oldest = throttled.keys().next();
    if (oldest.done) break;
    throttled.delete(oldest.value);
  }
}

async function withSlot<T>(task: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  if (Date.now() < circuitOpenUntil) return { ran: false };

  if (running >= MAX_CONCURRENCY) {
    if (waiting.length >= MAX_WAITING) return { ran: false };
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running++;
  try {
    const value = await task();
    return { ran: true, value };
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function onFetchResult(ok: boolean): void {
  if (ok) {
    consecutiveFailures = 0;
    return;
  }
  consecutiveFailures++;
  if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    consecutiveFailures = 0;
  }
}

async function downloadAndCompress(sourceUrl: string): Promise<Buffer | null> {
  let response: Response;
  try {
    response = await fetch(sourceUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) return null;

  let bytes: Uint8Array;
  try {
    const buf = await response.arrayBuffer();
    if (buf.byteLength > MAX_SOURCE_BYTES) return null;
    bytes = new Uint8Array(buf);
  } catch {
    return null;
  }

  try {
    return await sharp(bytes)
      .resize(OUTPUT_MAX_EDGE, OUTPUT_MAX_EDGE, { fit: "cover" })
      .webp({ quality: OUTPUT_QUALITY })
      .toBuffer();
  } catch {
    // 壊れたバイト列・非対応形式。sharpのデコード失敗はキャッシュをスキップする。
    return null;
  }
}

/**
 * subjectIdのアバターをRailway Bucketへキャッシュする。fire-and-forgetで呼ぶこと。
 * DBに新鮮な行(30日以内)が既にあれば何もしない。
 */
export async function ensureAvatarCached(
  kind: AvatarKind,
  subjectId: string,
  sourceUrl: string | null
): Promise<void> {
  if (!sourceUrl) return;
  // URL検証はネットワークI/Oの前、同時実行スロット/サーキットブレーカーの外側で行う。
  // ここで弾かれたリクエストは「実行した」扱いにしない(スロットもスロットリングも消費しない)。
  if (!isAllowedAvatarUrl(sourceUrl)) return;

  const key = buildAvatarKey(kind, subjectId);
  if (!key) return; // subjectIdが不正な形式。キャッシュ自体をスキップ。

  const now = Date.now();
  const tKey = throttleKey(kind, subjectId);
  if (isThrottled(tKey, now)) return;

  const existing = await prisma.tiktokAvatarAsset.findUnique({
    where: { kind_subjectId: { kind, subjectId } },
  });
  if (existing && now - existing.fetchedAt.getTime() < REFETCH_AFTER_MS) return;

  const storage = getMediaBucketClient();
  if (!storage) return;

  const result = await withSlot(() => downloadAndCompress(sourceUrl));
  if (!result.ran) return; // サーキットオープン or waiting上限超過。記録せず、次回の呼び出しに任せる。

  markThrottled(tKey, now);
  const compressed = result.value;
  onFetchResult(compressed !== null);
  if (compressed === null) return;

  try {
    await storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: key,
        Body: compressed,
        ContentType: OUTPUT_CONTENT_TYPE,
      })
    );
  } catch {
    return; // アップロード失敗。次回の呼び出しで再試行される(throttleが切れた後)。
  }

  await prisma.tiktokAvatarAsset.upsert({
    where: { kind_subjectId: { kind, subjectId } },
    create: { kind, subjectId, storageKey: key, contentType: OUTPUT_CONTENT_TYPE, byteSize: compressed.length },
    update: { storageKey: key, contentType: OUTPUT_CONTENT_TYPE, byteSize: compressed.length, fetchedAt: new Date() },
  });
}

/** 一覧表示用。distinct subjectIdをまとめて1回のfindManyで解決する(N+1回避)。 */
export async function resolveAvatarUrls(
  kind: AvatarKind,
  subjectIds: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (subjectIds.length === 0) return result;

  const storage = getMediaBucketClient();
  if (!storage) return result;

  const rows = await prisma.tiktokAvatarAsset.findMany({
    where: { kind, subjectId: { in: subjectIds } },
    select: { subjectId: true, storageKey: true },
  });

  for (const row of rows) {
    const url = await getSignedUrl(
      storage.client,
      new GetObjectCommand({ Bucket: storage.bucket, Key: row.storageKey }),
      { expiresIn: READ_URL_TTL_SECONDS }
    );
    result.set(row.subjectId, url);
  }

  return result;
}
