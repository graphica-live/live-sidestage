// 確定済み BattleHistory へ**再生用データだけを後付けする**バックフィル。
//
// **本番DBへの実行はユーザーの明示的な指示があってから行うこと**(書き込みを伴う)。
//
// backfill-battle-history.ts の `--force`(全置換)とは別物。全置換は participants /
// giftEvents / teams を現在のソース行で作り直すため、旧room削除で armies が cascade 消滅
// している行や、相手roomが消えた行、RoomConnectionInterval が変化した行で**確定済みデータを
// 劣化させる**。このスクリプトは `attachReplayData` を通し、`battle_history_score_points` の
// 入れ替えと opening 4列・replay*Count の update だけを行う。既存データを壊さないので
// 日数制限は不要で、途中で止めても「付加済み/未付加の混在」にしかならない(冪等)。
//
// 使い方:
//   npx tsx scripts/attach-replay-data.ts --dry-run   # 対象件数の見積もりのみ
//   npx tsx scripts/attach-replay-data.ts             # 未付加(replayScorePointCount=0)だけ処理
//   npx tsx scripts/attach-replay-data.ts --force     # 付加済みも再計算する
//   npx tsx scripts/attach-replay-data.ts --sender-group-only  # senderGroupId だけ埋める
//
// `--sender-group-only` は、**既に付加済み(replayScorePointCount>0)の行が通常モードでは
// スキップされる**ため用意した専用経路。senderGroupId(コンボの束ね鍵)は score points の
// 付加より後に足した列なので、既存の付加済み行は null のまま残る。元 `Gift` は受信から90日で
// 消えるので、**この経路は列追加から90日以内に流す必要がある**(過ぎた分は恒久的に取れない)。
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { attachReplayData, backfillSenderGroupIds } from "../src/lib/battle-history-finalize";

const TAG = "[attach-replay-data]";

const BATCH_SIZE = 500;
/** バッチ間の小休止。本番DBへ連続で負荷をかけない。 */
const BATCH_SLEEP_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  const senderGroupOnly = process.argv.includes("--sender-group-only");

  console.log(
    `${TAG} 開始${dryRun ? "(ドライラン)" : ""}${force ? "(付加済みも再計算)" : ""}` +
      `${senderGroupOnly ? "(senderGroupId のみ)" : ""}`
  );

  let scanned = 0;
  let targets = 0;
  let attached = 0;
  let withScorePoints = 0;
  let skippedSelfHostUnresolved = 0;
  let skippedNotFound = 0;
  let failed = 0;

  let cursor: string | null = null;

  for (;;) {
    // where を明示的に型注釈する(cursor の型が batch から逆算されて循環し TS7022 になるのを防ぐ)。
    const batchWhere: Prisma.BattleHistoryWhereInput = cursor === null ? {} : { id: { gt: cursor } };
    const batch = await prisma.battleHistory.findMany({
      where: batchWhere,
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      select: { id: true, roomId: true, battleId: true, replayScorePointCount: true },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    scanned += batch.length;

    for (const row of batch) {
      // 未付加の判定は replayScorePointCount で行う。**0 のまま残る行は正常にありうる**
      // (armies が cascade 消滅している等)ので、--force なしでは毎回再試行されることになる。
      // 付加そのものが軽い(2クエリ + update)ので許容する。
      if (!senderGroupOnly && !force && row.replayScorePointCount > 0) continue;
      targets++;
      if (dryRun) continue;

      if (senderGroupOnly) {
        try {
          await backfillSenderGroupIds(row.id);
          attached++;
        } catch (err) {
          failed++;
          console.error(`${TAG} 失敗 battleHistoryId=${row.id} roomId=${row.roomId} battleId=${row.battleId}`, err);
        }
        continue;
      }

      try {
        const result = await attachReplayData(row.id);
        if (result.attached) {
          attached++;
          if (result.scorePointCount > 0) withScorePoints++;
        } else if (result.reason === "self-host-unresolved") {
          skippedSelfHostUnresolved++;
        } else {
          skippedNotFound++;
        }
      } catch (err) {
        failed++;
        console.error(`${TAG} 失敗 battleHistoryId=${row.id} roomId=${row.roomId} battleId=${row.battleId}`, err);
      }
    }

    console.log(
      `${TAG} 進捗: 走査${scanned}件 / 対象${targets}件 / 付加${attached}(うちスコア点あり${withScorePoints}) ` +
        `hostTiktokUid未解決でスキップ${skippedSelfHostUnresolved} 行消失${skippedNotFound} 失敗${failed}`
    );

    if (batch.length < BATCH_SIZE) break;
    await sleep(BATCH_SLEEP_MS);
  }

  console.log(
    `${TAG} 完了${dryRun ? "(ドライラン: 書き込みなし)" : ""} — 走査${scanned}件 / 対象${targets}件 / ` +
      `付加${attached}(うちスコア点あり${withScorePoints}) hostTiktokUid未解決でスキップ${skippedSelfHostUnresolved} ` +
      `行消失${skippedNotFound} 失敗${failed}`
  );

  // 個別行の失敗はcatchして継続するが、exit code 0 を「全件成功」と誤認しないようにする。
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(`${TAG} 失敗`, err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
