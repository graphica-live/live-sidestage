// Worker専用エントリポイント。Next.js/socket.ioは持たず、担当shard(WORKER_INDEX)ぶんの
// TikTok Webcast接続だけを維持する軽量プロセス。`npm run worker` で起動する。
// 必須環境変数: WORKER_INDEX, WORKER_COUNT, DATABASE_URL, INTERNAL_API_SECRET, WEB_INTERNAL_URL
// (詳細は .env.example を参照)
//
// server.js経由のWebプロセスはNext.jsが.env(.local)を自動ロードするが、
// このプロセスはNext.jsを経由しないため明示的にロードする必要がある。
// Railway本番環境では.envファイルは存在せず、プラットフォームが直接環境変数を注入するため無害。
import "dotenv/config";
import { createServer } from "http";
import {
  resumeAllListeners,
  ensureAllListenersAlive,
  checkWatchdogs,
  stopAllListeners,
} from "@/lib/tiktok-listener";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to run worker.ts`);
  }
  return value;
}

requireEnv("WORKER_INDEX");
requireEnv("WORKER_COUNT");
requireEnv("WEB_INTERNAL_URL");
requireEnv("INTERNAL_API_SECRET");

// Railwayのデプロイ時ゼロダウンタイム切替に使うreadiness signal。
// 担当部屋のlistenerを1つも取りこぼさずに起動できたときだけ200を返す。
//
// 「例外が飛ばなかった」ではなく「起動失敗が0件」を条件にしているのは、
// resumeAllListeners()が部屋ごとの失敗を内部で握りつぶすため。DBが部分的に不調
// (接続枯渇など)だと、getMyRooms()は通るのに全部屋のstartListener()が落ちる、という
// 状態がありうる。以前はそれでもreadyになり、listenerが1つも動いていないWorkerを
// Railwayが健全と判断して旧Workerを落としていた。
let ready = false;

const healthPort = Number(process.env.PORT) || 8080;
const healthServer = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(ready ? 200 : 503, { "Content-Type": "text/plain" });
    res.end(ready ? "ok" : "starting");
    return;
  }
  res.writeHead(404);
  res.end();
});

// 定常時のreconcile間隔。unready(=担当部屋を起動できていない)の間だけ短くして、
// DB復旧からready復帰までの空白を詰める。60秒のままだと復旧を最大1分待たされる。
const RECONCILE_INTERVAL_MS = 60_000;
const UNREADY_RECONCILE_INTERVAL_MS = 5_000;

let reconcileTimer: NodeJS.Timeout | null = null;
let watchdogTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;
let reconcileRunning = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal} — starting graceful shutdown`);

  if (reconcileTimer) clearTimeout(reconcileTimer);
  if (watchdogTimer) clearInterval(watchdogTimer);

  await stopAllListeners().catch((err) =>
    console.error("[worker] stopAllListeners failed:", err)
  );

  healthServer.close(() => {
    console.log("[worker] shutdown complete");
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// 短間隔リトライとの多重起動を防ぐ。ensureAllListenersAlive()はDBアクセスを伴い、
// DB不調時ほど1回が長引くため、前回の実行が終わる前に次を重ねない。
async function reconcileOnce() {
  if (reconcileRunning || shuttingDown) return;
  reconcileRunning = true;
  try {
    const { roomCount, startFailures } = await ensureAllListenersAlive();
    if (!ready && startFailures === 0) {
      ready = true;
      console.log(`[worker] ready (recovered by reconcile, rooms=${roomCount})`);
    }
  } catch (err) {
    console.error("[worker] ensureAllListenersAlive failed:", err);
  } finally {
    reconcileRunning = false;
  }
}

function scheduleReconcile() {
  if (shuttingDown) return;
  reconcileTimer = setTimeout(
    async () => {
      await reconcileOnce();
      scheduleReconcile();
    },
    ready ? RECONCILE_INTERVAL_MS : UNREADY_RECONCILE_INTERVAL_MS
  );
}

async function main() {
  console.log(
    `[worker] starting (WORKER_INDEX=${process.env.WORKER_INDEX}, WORKER_COUNT=${process.env.WORKER_COUNT})`
  );

  healthServer.listen(healthPort, "0.0.0.0", () => {
    console.log(`[worker] healthcheck listening on :${healthPort}/healthz`);
  });

  const startedAt = Date.now();
  try {
    const { roomCount, startFailures } = await resumeAllListeners();
    if (startFailures === 0) {
      ready = true;
      console.log(
        `[worker] ready (rooms=${roomCount}, initial resume pass took ${Date.now() - startedAt}ms)`
      );
    } else {
      console.error(
        `[worker] initial resume could not start ${startFailures}/${roomCount} room(s) — staying unready`
      );
    }
  } catch (err) {
    console.error("[worker] resumeAllListeners failed — staying unready:", err);
  }

  scheduleReconcile();

  watchdogTimer = setInterval(() => {
    checkWatchdogs();
  }, 10_000);
}

main().catch((err) => {
  console.error("[worker] fatal error:", err);
  process.exit(1);
});
