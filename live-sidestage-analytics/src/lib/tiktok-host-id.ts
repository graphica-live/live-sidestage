import { prisma } from "./prisma";
import { fetchTiktokProfile, type TiktokProfileResult } from "./tiktok-profile";

// TiktokRoom.hostUserId(TikTok の数値 userId)を後から埋める補完ジョブ。
//
// なぜ必要か: バトル payload の `hostScores` は anchorIdStr(数値 userId)をキーに持つが、
// こちらは配信者をハンドル(tiktokId)でしか識別していない。この対応表がないと、
// 観測したバトルスコアを「どちらのサイドのものか」決められない。
//
// なぜ登録時に取らないか: src/event/CLAUDE.md の「参加者登録から TikTok へ問い合わせを足さない」。
// 主催者の一括登録が外部サービスの応答時間とレート制限に引きずられるため、
// 登録経路からは切り離して event-worker が後から埋める。
//
// tiktok-room-cleanup.ts と同じ設計パターン(純粋関数 + オーケストレータ + 上限・ディレイ・
// サーキットブレーカ)を踏襲する。`fetchTiktokProfile()` はプロキシなしの単一データセンターIPで、
// avatar キャッシュ(閲覧契機)と cleanup(日次)も同じ枠を共用しているため、撃ち方を揃えておく。
//
// **hostUserId は不変なので fill-once**。再取得も上書きもしない。したがって失敗の再試行台帳を
// DB に持つ必要はなく、プロセス内 Map のバックオフで足りる(再起動で消えても、
// 失敗した分をもう一度引き直すだけ)。複数レプリカが同時に走っても書き込みは冪等。

export const MAX_FILLS_PER_RUN = Number(process.env.TIKTOK_HOST_ID_MAX_PER_RUN ?? 40);
export const CONCURRENCY = Number(process.env.TIKTOK_HOST_ID_CONCURRENCY ?? 2);
export const BATCH_DELAY_MS = Number(process.env.TIKTOK_HOST_ID_BATCH_DELAY_MS ?? 1000);
/** 1周のうちに解決不能が連続したら、その周は打ち切る(TikTok 側の障害で撃ち続けない)。 */
export const CIRCUIT_THRESHOLD = Number(process.env.TIKTOK_HOST_ID_CIRCUIT_THRESHOLD ?? 5);

/**
 * 失敗した room を再び引くまでの待ち時間。理由で変える。
 * `NOT_FOUND` は当分変わらない(削除/改名)ので長く、レート制限と一時エラーは短く。
 */
export const BACKOFF_MS: Record<Exclude<TiktokProfileResult, { ok: true }>["reason"], number> = {
  NOT_FOUND: 24 * 60 * 60 * 1000,
  RATE_LIMITED: 30 * 60 * 1000,
  ERROR: 10 * 60 * 1000,
};

/** ハンドル -> 次に引いてよい時刻(epoch ms)。プロセス内のみ。 */
const backoffUntil = new Map<string, number>();

/** テスト用。プロセス内バックオフを空にする。 */
export function clearHostIdBackoff(): void {
  backoffUntil.clear();
}

export type PendingRoom = { id: string; tiktokId: string };

export type HostIdBackfillResult = {
  /** hostUserId を書き込めた件数。 */
  filled: number;
  /** 引いたが埋められなかった件数(NOT_FOUND / レート制限 / id が取れない)。 */
  failed: number;
  /** バックオフ中で今回引かなかった件数。 */
  skipped: number;
  /** サーキットブレーカで打ち切ったか。 */
  aborted: boolean;
};

export type HostIdBackfillDeps = {
  fetchProfile?: (tiktokId: string) => Promise<TiktokProfileResult>;
  /** hostUserId が未設定の room を返す。既に埋まっている room は返さないこと。 */
  listPendingRooms?: (tiktokIds: string[], limit: number) => Promise<PendingRoom[]>;
  /** 書き込み。既に値が入っている場合は何もしない実装であること。 */
  saveHostUserId?: (roomId: string, hostUserId: string) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxPerRun?: number;
  concurrency?: number;
  batchDelayMs?: number;
  circuitThreshold?: number;
};

/** バックオフ中かどうか。純粋関数。 */
export function isBackedOff(
  until: number | undefined,
  now: number
): boolean {
  return until !== undefined && until > now;
}

/** 失敗理由から次に引いてよい時刻を決める。純粋関数。 */
export function nextRetryAt(
  reason: Exclude<TiktokProfileResult, { ok: true }>["reason"],
  now: number
): number {
  return now + BACKOFF_MS[reason];
}

async function defaultListPendingRooms(
  tiktokIds: string[],
  limit: number
): Promise<PendingRoom[]> {
  return prisma.tiktokRoom.findMany({
    where: { tiktokId: { in: tiktokIds }, hostUserId: null },
    select: { id: true, tiktokId: true },
    take: limit,
  });
}

/**
 * hostUserId を書く。**`hostUserId: null` を where に入れて、一度入った値を上書きできないようにする。**
 * 不変値なので、レプリカ競合でも再取得でも「先に入ったものが勝つ」で正しい。
 */
async function defaultSaveHostUserId(roomId: string, hostUserId: string): Promise<void> {
  await prisma.tiktokRoom.updateMany({
    where: { id: roomId, hostUserId: null },
    data: { hostUserId },
  });
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 渡されたハンドルのうち `hostUserId` が未設定のものを TikTok に問い合わせて埋める。
 *
 * **失敗しても例外を投げない。** 呼び出し元(event-worker)にとっては付随処理で、
 * 集計ループを止めてよい理由がない。
 */
export async function backfillHostUserIds(
  tiktokIds: string[],
  deps: HostIdBackfillDeps = {}
): Promise<HostIdBackfillResult> {
  const fetchProfile = deps.fetchProfile ?? fetchTiktokProfile;
  const listPendingRooms = deps.listPendingRooms ?? defaultListPendingRooms;
  const saveHostUserId = deps.saveHostUserId ?? defaultSaveHostUserId;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const maxPerRun = deps.maxPerRun ?? MAX_FILLS_PER_RUN;
  const concurrency = deps.concurrency ?? CONCURRENCY;
  const batchDelayMs = deps.batchDelayMs ?? BATCH_DELAY_MS;
  const circuitThreshold = deps.circuitThreshold ?? CIRCUIT_THRESHOLD;

  const result: HostIdBackfillResult = { filled: 0, failed: 0, skipped: 0, aborted: false };
  if (tiktokIds.length === 0 || maxPerRun <= 0) return result;

  const pending = await listPendingRooms([...new Set(tiktokIds)], maxPerRun);
  const targets = pending.filter((room) => {
    if (isBackedOff(backoffUntil.get(room.tiktokId), now())) {
      result.skipped++;
      return false;
    }
    return true;
  });

  let consecutiveFailures = 0;

  for (let i = 0; i < targets.length; i += concurrency) {
    if (i > 0) await sleep(batchDelayMs);

    const batch = targets.slice(i, i + concurrency);
    const outcomes = await Promise.all(
      batch.map(async (room) => {
        try {
          const fetched = await fetchProfile(room.tiktokId);
          if (!fetched.ok) {
            backoffUntil.set(room.tiktokId, nextRetryAt(fetched.reason, now()));
            return false;
          }
          if (fetched.profile.userId === null) {
            // 実在はするが id が取れなかった(想定外のレスポンス形)。一時エラー扱いで待つ。
            backoffUntil.set(room.tiktokId, nextRetryAt("ERROR", now()));
            return false;
          }
          await saveHostUserId(room.id, fetched.profile.userId);
          backoffUntil.delete(room.tiktokId);
          return true;
        } catch (err) {
          console.error(`[tiktok-host-id] @${room.tiktokId} の hostUserId 取得に失敗:`, err);
          backoffUntil.set(room.tiktokId, nextRetryAt("ERROR", now()));
          return false;
        }
      })
    );

    for (const ok of outcomes) {
      if (ok) {
        result.filled++;
        consecutiveFailures = 0;
      } else {
        result.failed++;
        consecutiveFailures++;
      }
    }

    if (consecutiveFailures >= circuitThreshold) {
      result.aborted = true;
      break;
    }
  }

  return result;
}
