import { prisma } from "./prisma";
import { fetchTiktokProfile, type TiktokProfileResult } from "./tiktok-profile";

// TiktokRoom.hostUserId(TikTok の数値 userId)を後から埋める補完ジョブ。
//
// なぜ必要か: 用途は2つある。
//  1. バトル payload の `hostScores` は anchorIdStr(数値 userId)をキーに持つが、
//     こちらは配信者をハンドル(tiktokId)でしか識別していない。この対応表がないと、
//     観測したバトルスコアを「どちらのサイドのものか」決められない。
//  2. **TikTok ID 変更(改名)の検知。** ハンドルは変わるが数値 userId は変わらないので、
//     同じ hostUserId を持つ別ハンドルの Room を「同一アカウントの改名前後」と判定できる。
//     詳細は src/lib/tiktok-id-migration.ts。
//
// **2 には時間制約がある。** hostUserId は「そのハンドルが TikTok 上に存在するうち」しか
// 引けない。改名されると旧ハンドルは user_not_found になり永久に取得不能で、その Room は
// 改名の照合材料をまるごと失う。だから収集はイベント参加中の Room だけでなく
// **Streamer が紐づく全 Room** へ広げる(`backfillStreamerRoomHostIds`)。
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
//
// **ただし NOT_FOUND だけはプロセス内バックオフでは足りず、DB へ永続化する。** 理由は
// TiktokRoom.hostUserIdBackfillGaveUpAt のコメントを参照(要約すると、24時間後に同じハンドルを
// 引き直す間に第三者がそのハンドルを取得していると、第三者の userId を fill-once してしまい、
// 以後「この Room の持ち主は第三者だ」という誤った証明になる)。

export const MAX_FILLS_PER_RUN = Number(process.env.TIKTOK_HOST_ID_MAX_PER_RUN ?? 40);
export const CONCURRENCY = Number(process.env.TIKTOK_HOST_ID_CONCURRENCY ?? 2);
export const BATCH_DELAY_MS = Number(process.env.TIKTOK_HOST_ID_BATCH_DELAY_MS ?? 1000);
/** 1周のうちに解決不能が連続したら、その周は打ち切る(TikTok 側の障害で撃ち続けない)。 */
export const CIRCUIT_THRESHOLD = Number(process.env.TIKTOK_HOST_ID_CIRCUIT_THRESHOLD ?? 5);

/**
 * 候補を DB から引くときの掛け率。
 *
 * **プロセス内バックオフは take した「後」に効くので、ちょうど maxPerRun 件だけ引くと
 * 先頭がバックオフ中の周は処理 0 件で終わる。** 多めに引いてから絞ることで、
 * 一時エラーで待機中の Room が後続を押しのけないようにする。
 */
export const CANDIDATE_OVERSCAN = 3;

/**
 * 失敗した room を再び引くまでの待ち時間。理由で変える。
 * `NOT_FOUND` は当分変わらない(削除/改名)ので長く、レート制限と一時エラーは短く。
 *
 * NOT_FOUND は加えて DB へ「恒久的に諦めた」と記録するので、この値が効くのは
 * 記録に失敗したときの保険としてだけ。
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
  /** Streamer が紐づく room のうち hostUserId が未設定のものを返す。 */
  listStreamerRooms?: (limit: number) => Promise<PendingRoom[]>;
  /** 書き込み。既に値が入っている場合は何もしない実装であること。 */
  saveHostUserId?: (roomId: string, hostUserId: string) => Promise<void>;
  /**
   * 試行の記録。`gaveUp` は「TikTok が NOT_FOUND を返した = 二度と引かない」。
   * 失敗しても周を止めない(記録できなくてもプロセス内バックオフが効く)。
   */
  markAttempt?: (roomId: string, gaveUp: boolean) => Promise<void>;
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

/**
 * `hostUserId` を書いてよい room の条件。**候補抽出も書き込みもすべてこれを通す。**
 *
 * - `hostUserId: null` … 不変値なので fill-once。先に入ったものが勝つ
 * - `hostUserIdBackfillGaveUpAt: null` … 一度 `user_not_found` を観測した room には
 *   二度と書かない(理由は schema.prisma の当該列のコメント)
 *
 * どちらかを片方の経路だけに書くと、もう片方から汚染された fill が入りうる。
 * **規律は経路ごとの善意ではなく、この1つの定数で担保する。**
 */
export const HOST_USER_ID_WRITABLE_WHERE = {
  hostUserId: null,
  hostUserIdBackfillGaveUpAt: null,
} as const;

async function defaultListPendingRooms(
  tiktokIds: string[],
  limit: number
): Promise<PendingRoom[]> {
  return prisma.tiktokRoom.findMany({
    where: { ...HOST_USER_ID_WRITABLE_WHERE, tiktokId: { in: tiktokIds } },
    select: { id: true, tiktokId: true },
    take: limit,
  });
}

/**
 * Streamer が1人以上紐づく room のうち hostUserId が未設定のものを、
 * **最後に試した時刻の古い順(未試行を先頭)** に返す。
 *
 * 単純な createdAt 昇順にしないのは先頭詰まりを避けるため。解決しない room は
 * 何度引いても未設定のまま残るので、固定順で取ると同じ先頭 N 件を叩き続けて
 * それ以降へ永久に到達しない。試行のたびに hostUserIdAttemptedAt を進めることで
 * 候補が一巡する(tiktok-room-cleanup.ts の selectCleanupCandidates と同型)。
 */
async function defaultListStreamerRooms(limit: number): Promise<PendingRoom[]> {
  return prisma.tiktokRoom.findMany({
    where: { ...HOST_USER_ID_WRITABLE_WHERE, streamers: { some: {} } },
    select: { id: true, tiktokId: true },
    orderBy: { hostUserIdAttemptedAt: { sort: "asc", nulls: "first" } },
    take: limit,
  });
}

/**
 * hostUserId を fill-once で書く。**`hostUserId` を書く経路はすべてこの関数を通すこと。**
 *
 * 条件は `HOST_USER_ID_WRITABLE_WHERE` に一本化してある。呼び出し元が増えても
 * where 句を書き写さずに済むよう、書き込みそのものを共有する
 * (現在の呼び出し元は backfill と `src/lib/tiktok-id-migration.ts` のバトル逆引きの2つ)。
 */
export async function saveHostUserIdOnce(roomId: string, hostUserId: string): Promise<void> {
  const now = new Date();
  await prisma.tiktokRoom.updateMany({
    where: { id: roomId, ...HOST_USER_ID_WRITABLE_WHERE },
    data: { hostUserId, hostUserIdFilledAt: now, hostUserIdAttemptedAt: now },
  });
}

async function defaultMarkAttempt(roomId: string, gaveUp: boolean): Promise<void> {
  const now = new Date();
  await prisma.tiktokRoom.updateMany({
    where: { id: roomId, ...HOST_USER_ID_WRITABLE_WHERE },
    data: gaveUp
      ? { hostUserIdAttemptedAt: now, hostUserIdBackfillGaveUpAt: now }
      : { hostUserIdAttemptedAt: now },
  });
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 候補 room を TikTok に問い合わせて hostUserId を埋める共通エンジン。
 *
 * 候補の選び方(イベント lease 由来か全 Streamer room か)だけが呼び出し元で異なるので、
 * 撃ち方・バックオフ・サーキットブレーカはここへ集約する。
 *
 * **失敗しても例外を投げない。** 呼び出し元(event-worker)にとっては付随処理で、
 * 集計ループを止めてよい理由がない。
 */
async function runBackfill(
  candidates: PendingRoom[],
  deps: HostIdBackfillDeps,
  maxPerRun: number
): Promise<HostIdBackfillResult> {
  const fetchProfile = deps.fetchProfile ?? fetchTiktokProfile;
  const saveHostUserId = deps.saveHostUserId ?? saveHostUserIdOnce;
  const markAttempt = deps.markAttempt ?? defaultMarkAttempt;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const concurrency = deps.concurrency ?? CONCURRENCY;
  const batchDelayMs = deps.batchDelayMs ?? BATCH_DELAY_MS;
  const circuitThreshold = deps.circuitThreshold ?? CIRCUIT_THRESHOLD;

  const result: HostIdBackfillResult = { filled: 0, failed: 0, skipped: 0, aborted: false };

  // バックオフ中を除外してから上限で切る。**順序が逆だと先頭詰まりになる**
  // (バックオフ中の room で maxPerRun 枠が埋まり、処理 0 件で周が終わる)。
  const targets: PendingRoom[] = [];
  for (const room of candidates) {
    if (isBackedOff(backoffUntil.get(room.tiktokId), now())) {
      result.skipped++;
      continue;
    }
    if (targets.length < maxPerRun) targets.push(room);
  }

  /** 試行の記録は付随処理。失敗しても周の判定には影響させない。 */
  const recordAttempt = async (roomId: string, gaveUp: boolean): Promise<void> => {
    try {
      await markAttempt(roomId, gaveUp);
    } catch (err) {
      console.error(`[tiktok-host-id] room ${roomId} の試行記録に失敗:`, err);
    }
  };

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
            // **恒久的に諦めるのは TikTok が `user_not_found` を明示したときだけ。**
            // `reason: "NOT_FOUND"` は非 0 statusCode をまとめた粗い値で、bot 判定や
            // 一時的な異常応答も混ざる(tiktok-profile.ts の型コメント参照)。そちらで
            // 諦めると、TikTok の一時異常の間に引いた room が恒久的に補完不能になり、
            // 「材料が手遅れになる前に集める」という本ジョブの目的を自壊させる。
            await recordAttempt(room.id, fetched.explicitNotFound === true);
            return false;
          }
          if (fetched.profile.userId === null) {
            // 実在はするが id が取れなかった(想定外のレスポンス形)。一時エラー扱いで待つ。
            backoffUntil.set(room.tiktokId, nextRetryAt("ERROR", now()));
            await recordAttempt(room.id, false);
            return false;
          }
          await saveHostUserId(room.id, fetched.profile.userId);
          backoffUntil.delete(room.tiktokId);
          return true;
        } catch (err) {
          console.error(`[tiktok-host-id] @${room.tiktokId} の hostUserId 取得に失敗:`, err);
          backoffUntil.set(room.tiktokId, nextRetryAt("ERROR", now()));
          await recordAttempt(room.id, false);
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

/**
 * 渡されたハンドルのうち `hostUserId` が未設定のものを TikTok に問い合わせて埋める。
 *
 * イベント機能(監視中の lease)からの呼び出し用。入力が小さい有界集合なので
 * オーバースキャンはしない。
 */
export async function backfillHostUserIds(
  tiktokIds: string[],
  deps: HostIdBackfillDeps = {}
): Promise<HostIdBackfillResult> {
  const listPendingRooms = deps.listPendingRooms ?? defaultListPendingRooms;
  const maxPerRun = deps.maxPerRun ?? MAX_FILLS_PER_RUN;

  if (tiktokIds.length === 0 || maxPerRun <= 0) {
    return { filled: 0, failed: 0, skipped: 0, aborted: false };
  }

  const pending = await listPendingRooms([...new Set(tiktokIds)], maxPerRun);
  return runBackfill(pending, deps, maxPerRun);
}

/**
 * **Streamer が紐づく全 room** の `hostUserId` を埋める。
 *
 * 改名の照合材料はハンドルが生きているうちにしか集められないので、イベント参加中に
 * 限らず収集する。`backoffUntil` とサーキット閾値は module スコープで共有されるため、
 * イベント側の呼び出しと合算で撃ちすぎることはない。
 */
export async function backfillStreamerRoomHostIds(
  deps: HostIdBackfillDeps = {}
): Promise<HostIdBackfillResult> {
  const listStreamerRooms = deps.listStreamerRooms ?? defaultListStreamerRooms;
  const maxPerRun = deps.maxPerRun ?? MAX_FILLS_PER_RUN;

  if (maxPerRun <= 0) return { filled: 0, failed: 0, skipped: 0, aborted: false };

  const candidates = await listStreamerRooms(maxPerRun * CANDIDATE_OVERSCAN);
  return runBackfill(candidates, deps, maxPerRun);
}
