// Worker専用エントリポイント。Next.js/socket.ioは持たず、担当shard(WORKER_INDEX)ぶんの
// TikTok Webcast接続だけを維持する軽量プロセス。`npm run worker` で起動する。
// 必須環境変数: WORKER_INDEX, WORKER_COUNT, DATABASE_URL, INTERNAL_API_SECRET, WEB_INTERNAL_URL
// (詳細は .env.example を参照)
//
// server.js経由のWebプロセスはNext.jsが.env(.local)を自動ロードするが、
// このプロセスはNext.jsを経由しないため明示的にロードする必要がある。
// Railway本番環境では.envファイルは存在せず、プラットフォームが直接環境変数を注入するため無害。
import "dotenv/config";
import { resumeAllListeners, ensureAllListenersAlive, checkWatchdogs } from "@/lib/tiktok-listener";

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

async function main() {
  console.log(
    `[worker] starting (WORKER_INDEX=${process.env.WORKER_INDEX}, WORKER_COUNT=${process.env.WORKER_COUNT})`
  );

  await resumeAllListeners().catch((err) =>
    console.error("[worker] resumeAllListeners failed:", err)
  );

  setInterval(async () => {
    await ensureAllListenersAlive().catch((err) =>
      console.error("[worker] ensureAllListenersAlive failed:", err)
    );
  }, 60_000);

  setInterval(() => {
    checkWatchdogs();
  }, 10_000);
}

main().catch((err) => {
  console.error("[worker] fatal error:", err);
  process.exit(1);
});
