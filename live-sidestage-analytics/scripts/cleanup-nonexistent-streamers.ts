// TikTok上に存在しないtiktokId(打ち間違い等)で登録されたStreamerを見つけて削除する
// 手動メンテナンススクリプト。rebalance-workers.js と同じ dry-run / --apply 方式。
//
// 存在しないIDのStreamerは、部屋(TiktokRoom)がgetMyRooms()の
// 「streamers: some{}」条件を満たし続けるため、Workerが接続を永遠にリトライする
// (isUserOfflineError扱いになりOFFLINE_RECONNECT_DELAY_MSで再試行し続ける — 配信していない
// だけの正当なアカウントと区別できないため、tiktok-listener.ts側では自動停止しない)。
//
// 判定は tiktok-profile.ts の fetchTiktokProfile()(署名・Cookie不要、api-live/user/room/)。
// statusCode!==0 の NOT_FOUND のみを削除候補にする。RATE_LIMITED/ERROR は「判定できなかった」
// として扱い、誤って正当なStreamerを消さないよう削除しない。
//
// 安全策として、対応する部屋に受信済みGiftが1件でもあれば自動削除の対象から外し、
// 手動確認が要る一覧として出す(そのIDが過去に配信できていた=一時的な削除/凍結の可能性があり、
// 「打ち間違いで一度も繋がったことがない」ケースだけを機械的に消すため)。
//
// **配信者がTikTokで改名(uniqueId変更)した場合、この判定だけでは「打ち間違いで最初から
// 存在しない」と区別できない — 改名後は旧uniqueIdへの問い合わせが同じNOT_FOUNDになる。**
// 上のGift件数チェックが、既にギフトを受けていた改名済みアカウントの誤削除は防ぐ。
//
// TikTokのレスポンス(api-live/user/room/のdata.user)には永続的な安定ID `secUid` / `id` が
// 含まれるが、これを鍵にした逆引き(secUid→現在のuniqueId)は無認証では不可能と実測済み
// (2026-08確認):
//   - api/user/detail/?secUid=... → HTTP 200だが本文が完全に空(msToken等の署名必須API)
//   - api-live/user/room/?secUid=...(uniqueIdなし) → params_error。uniqueIdが必須パラメータ
//   - 正しいsecUid + 存在しないuniqueId → user_not_found(secUidは検索条件に一切使われない)
//   - node/share/user/@<id> → 403 Forbidden(即ブロック)
// EulerStream等の署名サービス経由でapi/user/detailを叩けば理論上は可能だが、追加コスト・
// 複雑性が見合わないため見送っている。同じ調査を繰り返さないための記録。
//
// 使い方:
//   npx tsx scripts/cleanup-nonexistent-streamers.ts           # dry-run(一覧表示のみ)
//   npx tsx scripts/cleanup-nonexistent-streamers.ts --apply   # 実際に削除
//
// ローカル: npm run cleanup:nonexistent-streamers:local
// 本番: DATABASE_URL を本番に向けて(または `railway run`)直接 npx tsx で実行する。
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { fetchTiktokProfile, type TiktokProfileResult } from "../src/lib/tiktok-profile";
import { normalizeTiktokId } from "../src/lib/tiktok-room";

// TikTokへ問い合わせを打ち切りすぎないための最小間隔。avatar-cacheの同時実行数(4)より
// 慎重に、逐次+間隔を空ける(このスクリプトは対話的に流すもので速度は要らない)。
const REQUEST_INTERVAL_MS = 500;
const RATE_LIMIT_RETRY_MS = 15_000;
const MAX_RATE_LIMIT_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveWithRetry(tiktokId: string): Promise<TiktokProfileResult> {
  for (let attempt = 0; ; attempt++) {
    const result = await fetchTiktokProfile(tiktokId);
    if (result.ok || result.reason !== "RATE_LIMITED" || attempt >= MAX_RATE_LIMIT_RETRIES) {
      return result;
    }
    console.log(`  @${tiktokId}: レート制限。${RATE_LIMIT_RETRY_MS / 1000}秒待って再試行...`);
    await sleep(RATE_LIMIT_RETRY_MS);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();

  try {
    const streamers = await prisma.streamer.findMany({
      select: { id: true, tiktokId: true, userId: true, roomId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    console.log(`Streamer ${streamers.length}件をTikTokへ照会します(1件あたり最短${REQUEST_INTERVAL_MS}ms間隔)。`);

    const deleteCandidates: typeof streamers = [];
    const needsReview: Array<{ streamer: (typeof streamers)[number]; giftCount: number }> = [];
    const inconclusive: Array<{ streamer: (typeof streamers)[number]; reason: string }> = [];

    for (const streamer of streamers) {
      const normalized = normalizeTiktokId(streamer.tiktokId);
      const result = await resolveWithRetry(normalized);

      if (result.ok) {
        // 実在する。何もしない。
      } else if (result.reason === "NOT_FOUND") {
        const giftCount = streamer.roomId
          ? await prisma.gift.count({ where: { roomId: streamer.roomId } })
          : 0;
        if (giftCount === 0) {
          deleteCandidates.push(streamer);
        } else {
          needsReview.push({ streamer, giftCount });
        }
      } else {
        inconclusive.push({ streamer, reason: result.reason });
      }

      await sleep(REQUEST_INTERVAL_MS);
    }

    console.log(`\n=== 削除候補(TikTok上に存在せず、受信ギフト0件): ${deleteCandidates.length}件 ===`);
    for (const s of deleteCandidates) {
      console.log(`  ${s.id} @${s.tiktokId} (userId=${s.userId}, 登録=${s.createdAt.toISOString()})`);
    }

    if (needsReview.length > 0) {
      console.log(`\n=== 要手動確認(TikTok上に存在しないが受信ギフトあり、自動削除しない): ${needsReview.length}件 ===`);
      for (const { streamer: s, giftCount } of needsReview) {
        console.log(`  ${s.id} @${s.tiktokId} (userId=${s.userId}, ギフト${giftCount}件)`);
      }
    }

    if (inconclusive.length > 0) {
      console.log(`\n=== 判定不能(レート制限/エラー、削除しない): ${inconclusive.length}件 ===`);
      for (const { streamer: s, reason } of inconclusive) {
        console.log(`  ${s.id} @${s.tiktokId} (${reason})`);
      }
    }

    if (!apply) {
      console.log("\ndry-runです。実際に削除するには --apply を付けて実行してください。");
      return;
    }

    if (deleteCandidates.length === 0) {
      console.log("\n削除対象なし。");
      return;
    }

    console.log(`\n${deleteCandidates.length}件を削除します...`);
    let deleted = 0;
    for (const s of deleteCandidates) {
      try {
        await prisma.streamer.delete({ where: { id: s.id } });
        deleted++;
      } catch (err) {
        console.error(`  @${s.tiktokId} の削除に失敗:`, err);
      }
    }
    console.log(
      `${deleted}件削除しました。対応する部屋(TiktokRoom)はそのまま残るが、他に監視要求がなければ次のreconcile(最大60秒)で接続が止まる。`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
