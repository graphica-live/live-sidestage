// 集計ワーカー専用エントリポイント。Next.js は持たず、開催中イベントの再集計だけを回す。
// `npm run worker` で起動する。必須環境変数は DATABASE_URL のみ(event_worker のロールを使う)。
//
// Web プロセスは Next.js が .env を自動ロードするが、このプロセスは経由しないため明示的に読む。
// Railway では .env が存在せずプラットフォームが環境変数を注入するので無害。
import "dotenv/config";
import { aggregateDueEvents } from "@/lib/aggregate";
import { renewClampedLeases } from "@/lib/participants";
import { prisma } from "@/lib/prisma";

const INTERVAL_MS = Number(process.env.AGGREGATE_INTERVAL_MS ?? 10_000);
/** SLO は1周10秒。その半分を超えたら増分 rollup への移行を検討する合図として警告する。 */
const SLO_WARN_MS = 5_000;

/**
 * 監視期限の延長を確認する間隔。切り詰めが起きるのは終了が120日以上先のイベントだけなので、
 * 集計と同じ頻度で回す必要はない。
 * これを動かすには worker サービスにも ANALYTICS_INTERNAL_URL と
 * EVENT_INTERNAL_API_SECRET が要る(未設定なら警告だけ出して何もしない)。
 */
const RENEW_INTERVAL_MS = Number(process.env.LEASE_RENEW_INTERVAL_MS ?? 60 * 60 * 1000);

let inFlight = false;
let stopping = false;
let currentTick: Promise<void> = Promise.resolve();
let renewInFlight = false;

async function tick(): Promise<void> {
  // analytics の worker.ts には guard がないが、こちらは1周が長くなりうるので必ず持つ。
  // 前の周が終わる前に次を始めると、advisory lock で弾かれるだけの無駄な往復が増える。
  if (inFlight || stopping) return;
  inFlight = true;

  try {
    const result = await aggregateDueEvents();
    if (result.processed > 0 || result.failed > 0) {
      console.log(
        `[worker] 集計 ${result.processed}件 / スキップ ${result.skipped}件 / 失敗 ${result.failed}件 (${result.totalMs}ms)`
      );
    }
    if (result.totalMs > SLO_WARN_MS && result.processed > 0) {
      console.warn(
        `[worker] 1周が ${result.totalMs}ms かかった(SLO 10000ms の警告閾値 ${SLO_WARN_MS}ms 超過)。` +
          `増分 rollup への移行を検討すること。`
      );
    }
  } catch (err) {
    console.error("[worker] 集計ループでエラー:", err);
  } finally {
    inFlight = false;
  }
}

async function renewTick(): Promise<void> {
  if (renewInFlight || stopping) return;
  if (!process.env.ANALYTICS_INTERNAL_URL || !process.env.EVENT_INTERNAL_API_SECRET) {
    console.warn(
      "[worker] ANALYTICS_INTERNAL_URL / EVENT_INTERNAL_API_SECRET が未設定なので監視期限の延長を行わない。" +
        "終了が120日以上先のイベントでは監視が途中で止まる。"
    );
    return;
  }

  renewInFlight = true;
  try {
    const result = await renewClampedLeases();
    if (result.renewed > 0 || result.failed > 0) {
      console.log(`[worker] 監視期限を延長 ${result.renewed}件 / 失敗 ${result.failed}件`);
    }
  } catch (err) {
    console.error("[worker] 監視期限の延長でエラー:", err);
  } finally {
    renewInFlight = false;
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal} を受信。実行中の集計の完了を待つ。`);

  clearInterval(timer);
  clearInterval(renewTimer);
  await currentTick.catch(() => {});
  await prisma.$disconnect().catch(() => {});
  console.log("[worker] 終了");
  process.exit(0);
}

function scheduleTick() {
  currentTick = tick();
}

const timer = setInterval(scheduleTick, INTERVAL_MS);
const renewTimer = setInterval(() => void renewTick(), RENEW_INTERVAL_MS);

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log(
  `[worker] 集計ワーカーを開始した(集計 ${INTERVAL_MS}ms / 監視期限の確認 ${RENEW_INTERVAL_MS}ms)`
);
scheduleTick();
void renewTick();
