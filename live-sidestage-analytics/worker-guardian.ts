// TikTok接続worker(worker1/2/3)のプロセスレベルの死活監視+自動移送。専用エントリポイント。
// `npm run worker-guardian` で起動する。worker.ts/event-worker.ts と同じイメージの別サービスとして
// デプロイする(単一プロセスの障害がWebやTikTok接続を巻き込まないようにするため)。
//
// Webプロセスは Next.js が .env を自動ロードするが、このプロセスは経由しないため明示的に読む。
// Railwayでは .env が存在せずプラットフォームが環境変数を注入するため無害。
import "dotenv/config";
import { createServer } from "http";
import { prisma } from "@/lib/prisma";
import { createInitialState, runGuardianCycle, type GuardianState } from "@/lib/worker-guardian";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to run worker-guardian.ts`);
  }
  return value;
}

requireEnv("DATABASE_URL");
requireEnv("INTERNAL_API_SECRET");
requireEnv("WORKER_COUNT");
requireEnv("WORKER_INTERNAL_URLS");

const POLL_INTERVAL_MS = Number(process.env.WORKER_GUARDIAN_POLL_INTERVAL_MS ?? 30_000);

let state: GuardianState = createInitialState();
let inFlight = false;
let stopping = false;
let currentCycle: Promise<void> = Promise.resolve();
let lastCycleAt: string | null = null;

async function tick(): Promise<void> {
  // event-worker.ts と同じ guard。前サイクルが詰まっているときに次を重ねない。
  if (inFlight || stopping) return;
  inFlight = true;
  try {
    state = await runGuardianCycle(state);
    lastCycleAt = new Date().toISOString();
  } catch (err) {
    console.error("[worker-guardian] サイクル実行中に予期しないエラー:", err);
  } finally {
    inFlight = false;
  }
}

function scheduleTick() {
  currentCycle = tick();
}

// このサービスにゼロダウンタイム切替の要件はない(TikTok接続を持たず、DBのworkerId列を
// 書き換えるだけの単純なポーリングジョブ)。/healthz は起動していれば常に200を返し、
// クラッシュ時の再起動は railway.toml の restartPolicyType=ON_FAILURE に任せる。
const healthPort = Number(process.env.PORT) || 8080;
const healthServer = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.url === "/status") {
    const secret = process.env.INTERNAL_API_SECRET;
    if (!secret || req.headers["x-internal-secret"] !== secret) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        lastCycleAt,
        streaks: Object.fromEntries(state.streaks),
        lastMigrationAt: state.lastMigrationAt ? new Date(state.lastMigrationAt).toISOString() : null,
      })
    );
    return;
  }

  res.writeHead(404);
  res.end();
});

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker-guardian] ${signal}を受信。実行中のサイクルの完了を待つ`);

  clearInterval(timer);
  await currentCycle.catch(() => {});
  await prisma.$disconnect().catch(() => {});
  healthServer.close(() => {
    console.log("[worker-guardian] 終了");
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

healthServer.listen(healthPort, "0.0.0.0", () => {
  console.log(`[worker-guardian] healthcheck listening on :${healthPort}/healthz`);
});

const timer = setInterval(scheduleTick, POLL_INTERVAL_MS);
console.log(`[worker-guardian] 起動(poll間隔 ${POLL_INTERVAL_MS}ms)`);
scheduleTick();
