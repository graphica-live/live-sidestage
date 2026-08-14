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
// resumeAllListeners()の初回パスが終わるまでは503を返し、Railwayが
// 「新Workerが本当にTikTokへ接続を試み終えた」ことを確認してから
// 旧Workerへのteardownを進められるようにする。
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

let ensureAliveTimer: NodeJS.Timeout | null = null;
let watchdogTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal} — starting graceful shutdown`);

  if (ensureAliveTimer) clearInterval(ensureAliveTimer);
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

async function main() {
  console.log(
    `[worker] starting (WORKER_INDEX=${process.env.WORKER_INDEX}, WORKER_COUNT=${process.env.WORKER_COUNT})`
  );

  healthServer.listen(healthPort, "0.0.0.0", () => {
    console.log(`[worker] healthcheck listening on :${healthPort}/healthz`);
  });

  const startedAt = Date.now();
  await resumeAllListeners().catch((err) =>
    console.error("[worker] resumeAllListeners failed:", err)
  );
  ready = true;
  console.log(`[worker] ready (initial resume pass took ${Date.now() - startedAt}ms)`);

  ensureAliveTimer = setInterval(async () => {
    await ensureAllListenersAlive().catch((err) =>
      console.error("[worker] ensureAllListenersAlive failed:", err)
    );
  }, 60_000);

  watchdogTimer = setInterval(() => {
    checkWatchdogs();
  }, 10_000);
}

main().catch((err) => {
  console.error("[worker] fatal error:", err);
  process.exit(1);
});
