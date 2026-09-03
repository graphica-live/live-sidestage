// イベント集計ワーカー専用エントリポイント。Next.js は持たず、開催中イベントの再集計だけを回す。
// `npm run event-worker` で起動する。必須環境変数は DATABASE_URL のみ。
//
// TikTok 接続を維持する worker.ts とは別プロセスにする。集計が詰まっても Webcast の
// WebSocket を巻き込まないようにするため(Railway では別サービスとしてデプロイする)。
//
// Web プロセスは Next.js が .env を自動ロードするが、このプロセスは経由しないため明示的に読む。
// Railway では .env が存在せずプラットフォームが環境変数を注入するので無害。
import "dotenv/config";
import { aggregateDueEvents } from "@/event/aggregate";
import { activeLeaseTiktokIds, renewClampedLeases } from "@/event/participants";
import { backfillHostUserIds, backfillStreamerRoomHostIds } from "@/lib/tiktok-host-id";
import { snapshotDueEventAvatars } from "@/event/avatar-snapshot";
import { processPendingMergeJobs } from "@/lib/tiktok-id-migration";
import { autoFinishOverdueEvents } from "@/event/auto-finish";
import { prisma } from "@/lib/prisma";

const INTERVAL_MS = Number(process.env.AGGREGATE_INTERVAL_MS ?? 10_000);
/** SLO は1周10秒。その半分を超えたら増分 rollup への移行を検討する合図として警告する。 */
const SLO_WARN_MS = 5_000;

/**
 * 監視期限の延長を確認する間隔。切り詰めが起きるのは終了が120日以上先のイベントだけなので、
 * 集計と同じ頻度で回す必要はない。
 */
const RENEW_INTERVAL_MS = Number(process.env.LEASE_RENEW_INTERVAL_MS ?? 60 * 60 * 1000);

/**
 * TiktokRoom.hostUserId(TikTok の数値 userId)の補完を回す間隔。
 * バトルスコアをサイドへ帰属させるのに要る対応表で、一度埋まれば二度と引かない。
 * **0 を指定すると補完自体を止める**(TikTok 側のレート制限に困ったときの逃げ道)。
 */
const HOST_ID_INTERVAL_MS = Number(process.env.TIKTOK_HOST_ID_INTERVAL_MS ?? 60_000);

/**
 * **Streamer が紐づく全 Room** の hostUserId 補完を回す間隔(上のイベント lease 由来とは別枠)。
 *
 * イベント参加中に限らず集める理由は時間制約。hostUserId は「そのハンドルが TikTok 上に
 * 存在するうち」しか引けず、改名されると旧ハンドルは永久に取得不能になる。改名の検知
 * (src/lib/tiktok-id-migration.ts)はこの対応表が唯一の materials なので、先回りして集める。
 *
 * 一度埋まれば二度と引かないので、負荷は初回の在庫消化が全て。
 * **0 を指定すると止まる**(TikTok 側のレート制限に困ったときの逃げ道)。
 */
const STREAMER_HOST_ID_INTERVAL_MS = Number(
  process.env.STREAMER_HOST_ID_INTERVAL_MS ?? 5 * 60_000
);

/**
 * イベントの参加者アイコンをスナップショットする間隔(Event.startAt 到来チェック)。
 * 一度スナップショットしたイベントは対象から外れるので、集計ほど頻繁に回す必要はない。
 */
const AVATAR_SNAPSHOT_INTERVAL_MS = Number(process.env.EVENT_AVATAR_SNAPSHOT_INTERVAL_MS ?? 60_000);

/**
 * TikTok ID変更時の room 合流(src/lib/tiktok-id-migration.ts)を処理する間隔。
 * 対象は TiktokIdMergeJob(pending)。TikTok への問い合わせを伴うので、集計ループとは別枠にする。
 */
const MERGE_TICK_INTERVAL_MS = Number(process.env.TIKTOK_ID_MERGE_TICK_INTERVAL_MS ?? 60_000);
const MERGE_TICK_MAX_PER_RUN = Number(process.env.TIKTOK_ID_MERGE_MAX_PER_RUN ?? 5);

/**
 * 開催終了後もRUNNINGのまま放置されたイベントを自動でFINISHEDにする確認間隔。
 * 猶予(AUTO_FINISH_GRACE_MS、既定2日)そのものに比べれば十分短い頻度でよいので、
 * 監視期限の延長確認(RENEW_INTERVAL_MS)と同じ1時間おきにする。
 */
const AUTO_FINISH_INTERVAL_MS = Number(process.env.EVENT_AUTO_FINISH_INTERVAL_MS ?? 60 * 60 * 1000);

let inFlight = false;
let stopping = false;
let currentTick: Promise<void> = Promise.resolve();
let renewInFlight = false;
let hostIdInFlight = false;
let streamerHostIdInFlight = false;
let avatarSnapshotInFlight = false;
let mergeTickInFlight = false;
let autoFinishInFlight = false;

async function tick(): Promise<void> {
  // worker.ts(TikTok接続)には guard がないが、こちらは1周が長くなりうるので必ず持つ。
  // 前の周が終わる前に次を始めると、advisory lock で弾かれるだけの無駄な往復が増える。
  if (inFlight || stopping) return;
  inFlight = true;

  try {
    const result = await aggregateDueEvents();
    if (result.processed > 0 || result.failed > 0) {
      console.log(
        `[event-worker] 集計 ${result.processed}件 / スキップ ${result.skipped}件 / 失敗 ${result.failed}件 (${result.totalMs}ms)`
      );
    }
    if (result.totalMs > SLO_WARN_MS && result.processed > 0) {
      console.warn(
        `[event-worker] 1周が ${result.totalMs}ms かかった(SLO 10000ms の警告閾値 ${SLO_WARN_MS}ms 超過)。` +
          `増分 rollup への移行を検討すること。`
      );
    }
  } catch (err) {
    console.error("[event-worker] 集計ループでエラー:", err);
  } finally {
    inFlight = false;
  }
}

// 監視期限(TiktokRoom.monitorUntil)の延長。
// 統合前は analytics の内部API を叩いていたため URL と secret が要ったが、
// 今は同じ DB を直接更新するので追加の環境変数はいらない。
async function renewTick(): Promise<void> {
  if (renewInFlight || stopping) return;

  renewInFlight = true;
  try {
    const result = await renewClampedLeases();
    if (result.renewed > 0 || result.failed > 0) {
      console.log(`[event-worker] 監視期限を延長 ${result.renewed}件 / 失敗 ${result.failed}件`);
    }
  } catch (err) {
    console.error("[event-worker] 監視期限の延長でエラー:", err);
  } finally {
    renewInFlight = false;
  }
}

// TiktokRoom.hostUserId の補完。バトル payload の hostScores は数値 userId をキーに持つので、
// この対応表がないとスコアをサイドへ帰属させられない。
//
// 参加者登録の経路からは切り離してある(src/event/CLAUDE.md「参加者登録から TikTok へ
// 問い合わせを足さない」)。TikTok を叩くので、失敗しても集計ループには影響させない。
async function hostIdTick(): Promise<void> {
  if (hostIdInFlight || stopping) return;

  hostIdInFlight = true;
  try {
    const tiktokIds = await activeLeaseTiktokIds();
    if (tiktokIds.length === 0) return;

    const result = await backfillHostUserIds(tiktokIds);
    if (result.filled > 0 || result.aborted) {
      console.log(
        `[event-worker] hostUserId を補完 ${result.filled}件 / 失敗 ${result.failed}件 / ` +
          `バックオフ中 ${result.skipped}件${result.aborted ? " (連続失敗で打ち切り)" : ""}`
      );
    }
  } catch (err) {
    console.error("[event-worker] hostUserId の補完でエラー:", err);
  } finally {
    hostIdInFlight = false;
  }
}

// Streamer が紐づく全 Room の hostUserId 補完(イベント lease 由来とは別枠)。
//
// **イベント側の hostIdTick を優先する。** 同じセマフォ・同じサーキットブレーカを共有するので、
// 両方を同時に走らせると片方が枠を食い合う。イベントは開催中の締切があるぶん優先度が高い。
async function streamerHostIdTick(): Promise<void> {
  if (streamerHostIdInFlight || hostIdInFlight || stopping) return;

  streamerHostIdInFlight = true;
  try {
    const result = await backfillStreamerRoomHostIds();
    if (result.filled > 0 || result.aborted) {
      console.log(
        `[event-worker] Streamer room の hostUserId を補完 ${result.filled}件 / ` +
          `失敗 ${result.failed}件 / バックオフ中 ${result.skipped}件` +
          `${result.aborted ? " (連続失敗で打ち切り)" : ""}`
      );
    }
  } catch (err) {
    console.error("[event-worker] Streamer room の hostUserId 補完でエラー:", err);
  } finally {
    streamerHostIdInFlight = false;
  }
}

// イベントのトーナメント表・参加者アイコンを startAt 到来時点で恒久ストレージへスナップショットする。
// 個々の参加者の失敗はライブ取得への永続フォールバックに任せるので、集計ループには影響させない。
async function avatarSnapshotTick(): Promise<void> {
  if (avatarSnapshotInFlight || stopping) return;

  avatarSnapshotInFlight = true;
  try {
    const result = await snapshotDueEventAvatars();
    if (result.eventsProcessed > 0) {
      console.log(
        `[event-worker] アイコンをスナップショット ${result.eventsProcessed}イベント ` +
          `(成功 ${result.succeeded}件 / 失敗 ${result.failed}件)`
      );
    }
  } catch (err) {
    console.error("[event-worker] アイコンのスナップショットでエラー:", err);
  } finally {
    avatarSnapshotInFlight = false;
  }
}

// TikTok ID変更に伴う room 合流ジョブを処理する。TikTok を叩くので失敗しても集計ループには影響させない。
async function mergeTick(): Promise<void> {
  if (mergeTickInFlight || stopping) return;

  mergeTickInFlight = true;
  try {
    const result = await processPendingMergeJobs(MERGE_TICK_MAX_PER_RUN);
    if (result.processed > 0) {
      console.log(`[event-worker] TikTok ID合流ジョブ ${result.processed}件処理`);
    }
  } catch (err) {
    console.error("[event-worker] TikTok ID合流ジョブでエラー:", err);
  } finally {
    mergeTickInFlight = false;
  }
}

// 開催終了(endAt到来)+猶予を過ぎてもRUNINGのまま放置されたイベントをFINISHEDへ遷移させる。
// 集計・監視のロジックには影響しない(表示上の状態合わせ)。
async function autoFinishTick(): Promise<void> {
  if (autoFinishInFlight || stopping) return;

  autoFinishInFlight = true;
  try {
    const result = await autoFinishOverdueEvents();
    if (result.finished > 0) {
      console.log(`[event-worker] 開催終了後放置されていたイベントを自動終了 ${result.finished}件`);
    }
  } catch (err) {
    console.error("[event-worker] イベントの自動終了でエラー:", err);
  } finally {
    autoFinishInFlight = false;
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[event-worker] ${signal} を受信。実行中の集計の完了を待つ。`);

  clearInterval(timer);
  clearInterval(renewTimer);
  if (hostIdTimer) clearInterval(hostIdTimer);
  if (streamerHostIdTimer) clearInterval(streamerHostIdTimer);
  clearInterval(avatarSnapshotTimer);
  clearInterval(mergeTimer);
  clearInterval(autoFinishTimer);
  await currentTick.catch(() => {});
  await mergeTickCurrent.catch(() => {});
  await prisma.$disconnect().catch(() => {});
  console.log("[event-worker] 終了");
  process.exit(0);
}

function scheduleTick() {
  currentTick = tick();
}

let mergeTickCurrent: Promise<void> = Promise.resolve();
function scheduleMergeTick() {
  mergeTickCurrent = mergeTick();
}

const timer = setInterval(scheduleTick, INTERVAL_MS);
const renewTimer = setInterval(() => void renewTick(), RENEW_INTERVAL_MS);
const hostIdTimer =
  HOST_ID_INTERVAL_MS > 0 ? setInterval(() => void hostIdTick(), HOST_ID_INTERVAL_MS) : null;
const streamerHostIdTimer =
  STREAMER_HOST_ID_INTERVAL_MS > 0
    ? setInterval(() => void streamerHostIdTick(), STREAMER_HOST_ID_INTERVAL_MS)
    : null;
const avatarSnapshotTimer = setInterval(() => void avatarSnapshotTick(), AVATAR_SNAPSHOT_INTERVAL_MS);
const mergeTimer = setInterval(scheduleMergeTick, MERGE_TICK_INTERVAL_MS);
const autoFinishTimer = setInterval(() => void autoFinishTick(), AUTO_FINISH_INTERVAL_MS);

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log(
  `[event-worker] イベント集計ワーカーを開始した(集計 ${INTERVAL_MS}ms / 監視期限の確認 ${RENEW_INTERVAL_MS}ms / ` +
    `hostUserId の補完 ${HOST_ID_INTERVAL_MS > 0 ? `${HOST_ID_INTERVAL_MS}ms` : "無効"} / ` +
    `Streamer room の hostUserId 補完 ${
      STREAMER_HOST_ID_INTERVAL_MS > 0 ? `${STREAMER_HOST_ID_INTERVAL_MS}ms` : "無効"
    } / ` +
    `アイコンのスナップショット ${AVATAR_SNAPSHOT_INTERVAL_MS}ms / ` +
    `TikTok ID合流ジョブ ${MERGE_TICK_INTERVAL_MS}ms/最大${MERGE_TICK_MAX_PER_RUN}件 / ` +
    `開催終了後の自動終了 ${AUTO_FINISH_INTERVAL_MS}ms)`
);
scheduleTick();
void renewTick();
if (hostIdTimer) void hostIdTick();
if (streamerHostIdTimer) void streamerHostIdTick();
void avatarSnapshotTick();
scheduleMergeTick();
void autoFinishTick();
