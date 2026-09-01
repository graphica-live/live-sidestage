import { prisma } from "@/lib/prisma";
import { fetchTiktokProfile, type TiktokProfileResult } from "@/lib/tiktok-profile";
import { ensureAvatarCached } from "@/lib/avatar-storage";

// イベントのトーナメント表・参加者アイコンを、Event.startAt 到来時点で1回だけ
// 自前ストレージ(TiktokAvatarAsset, kind: "event_participant")へスナップショットする。
//
// **これは src/event/CLAUDE.md の「配信者アイコンの URL を永続化しない」の例外ではない。**
// あの節が禁止しているのは「署名付き URL の文字列を DB 列へ保存すること」で、ここでやるのは
// 既にバトル履歴・貢献タブが使っている恒久保存方式(画像バイトを Bucket へダウンロードし、
// DB にはオブジェクトキーだけを持つ)の再利用。URL 自体は一切 DB へ書かない。
//
// **fill-once ではなく try-once。** hostUserId 補完(tiktok-host-id.ts)と違い、個々の参加者の
// 取得に失敗しても re-fetch を試み続けない — Event.avatarsSnapshottedAt は成否に関わらず
// このジョブの1回の実行で立てる。失敗した参加者は `/api/public/avatar/[participantId]` の
// ライブ取得(avatarCache 経由の 302)へ永続的にフォールバックし続ける(仕様)。

/** 1周で処理するイベント数の上限。1イベントの参加者数は数十〜数百なので大きくしない。 */
export const MAX_EVENTS_PER_RUN = Number(process.env.EVENT_AVATAR_SNAPSHOT_MAX_EVENTS ?? 5);
/** 参加者への同時問い合わせ数。tiktok-host-id.ts と同じ枠(単一データセンターIP)を意識する。 */
export const CONCURRENCY = Number(process.env.EVENT_AVATAR_SNAPSHOT_CONCURRENCY ?? 2);
export const BATCH_DELAY_MS = Number(process.env.EVENT_AVATAR_SNAPSHOT_BATCH_DELAY_MS ?? 1000);

export type DueEvent = { id: string; tiktokIds: string[] };

export type AvatarSnapshotResult = {
  /** スナップショットを試みたイベント数(成否問わず avatarsSnapshottedAt を立てた数)。 */
  eventsProcessed: number;
  /** 参加者アイコンの取得・保存に成功した件数。 */
  succeeded: number;
  /** 参加者アイコンの取得・保存に失敗した件数(ライブ取得へ永続フォールバックする)。 */
  failed: number;
};

export type AvatarSnapshotDeps = {
  fetchProfile?: (tiktokId: string) => Promise<TiktokProfileResult>;
  cacheAvatar?: (kind: "event_participant", subjectId: string, sourceUrl: string | null) => Promise<void>;
  listDueEvents?: (now: Date, limit: number) => Promise<DueEvent[]>;
  markSnapshotted?: (eventId: string, at: Date) => Promise<void>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  maxEvents?: number;
  concurrency?: number;
  batchDelayMs?: number;
};

async function defaultListDueEvents(now: Date, limit: number): Promise<DueEvent[]> {
  const events = await prisma.event.findMany({
    where: { startAt: { lte: now }, avatarsSnapshottedAt: null },
    select: { id: true, participants: { select: { tiktokId: true } } },
    take: limit,
    orderBy: { startAt: "asc" },
  });
  return events.map((e) => ({
    id: e.id,
    tiktokIds: [...new Set(e.participants.map((p) => p.tiktokId))],
  }));
}

async function defaultMarkSnapshotted(eventId: string, at: Date): Promise<void> {
  await prisma.event.updateMany({
    where: { id: eventId, avatarsSnapshottedAt: null },
    data: { avatarsSnapshottedAt: at },
  });
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * startAt を迎えた未スナップショットのイベントを見つけ、参加者アイコンを
 * TiktokAvatarAsset(kind: "event_participant") へ保存する。**失敗しても例外を投げない**
 * (event-worker の集計ループを止めてよい理由がない)。
 */
export async function snapshotDueEventAvatars(
  deps: AvatarSnapshotDeps = {}
): Promise<AvatarSnapshotResult> {
  const fetchProfile = deps.fetchProfile ?? fetchTiktokProfile;
  const cacheAvatar = deps.cacheAvatar ?? ensureAvatarCached;
  const listDueEvents = deps.listDueEvents ?? defaultListDueEvents;
  const markSnapshotted = deps.markSnapshotted ?? defaultMarkSnapshotted;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const maxEvents = deps.maxEvents ?? MAX_EVENTS_PER_RUN;
  const concurrency = deps.concurrency ?? CONCURRENCY;
  const batchDelayMs = deps.batchDelayMs ?? BATCH_DELAY_MS;

  const result: AvatarSnapshotResult = { eventsProcessed: 0, succeeded: 0, failed: 0 };
  if (maxEvents <= 0) return result;

  const dueEvents = await listDueEvents(now(), maxEvents);

  for (const event of dueEvents) {
    for (let i = 0; i < event.tiktokIds.length; i += concurrency) {
      if (i > 0) await sleep(batchDelayMs);

      const batch = event.tiktokIds.slice(i, i + concurrency);
      const outcomes = await Promise.all(
        batch.map(async (tiktokId) => {
          try {
            const fetched = await fetchProfile(tiktokId);
            if (!fetched.ok) return false;
            await cacheAvatar("event_participant", tiktokId, fetched.profile.avatarUrl);
            return true;
          } catch (err) {
            console.error(`[avatar-snapshot] @${tiktokId} のアイコン保存に失敗:`, err);
            return false;
          }
        })
      );

      for (const ok of outcomes) {
        if (ok) result.succeeded++;
        else result.failed++;
      }
    }

    await markSnapshotted(event.id, now());
    result.eventsProcessed++;
  }

  return result;
}
