// バトル履歴の確定テーブル(BattleHistory / BattleHistoryParticipant / BattleHistoryGiftEvent等)の
// バックフィル。既存の終了済みバトルを、確定処理と同じロジックでまとめてスナップショット化する。
//
// **本番DBへの実行はユーザーの明示的な指示があってから行うこと**(書き込みを伴う)。
//
// 設計(冪等・CAS・dry-run):
//
// - 駆動クエリは軽量列のみ(hostProfiles 等の重い列は取らない)。id カーソルで500件ずつ走査する。
// - **action による事前フィルタはしない。** 全行に resolveBattleWindow を適用し、status が
//   finished/cut_short かつ window.end !== null のものだけを対象にする(現行UIの「終了扱い」判定と
//   完全に一致させるため。action だけで絞ると OPEN のまま endedAt が埋まっている行や
//   duration 経過済みの行を取りこぼす)。
// - **windowEnd がスクリプト実行時刻より24時間以上前の行に限定する。** 直近終了したばかりの
//   バトルは Gift・スコアがまだ静止していない可能性があるため、確定処理の60秒安定性チェックと
//   同じ理由で対象外にする。24時間経過していれば実務上ほぼ確実に静止しているので、
//   バックフィルでは安定性チェック(60秒待って再計算)を省き computeBattleSnapshot を1回だけ呼ぶ。
// - **保存単位は (roomId, battleId) ペア**であり battleId 単独ではない。同じバトルを複数 room が
//   観測している場合、双方の room 行をそれぞれ確定する必要がある。処理済みキーは
//   `${roomId}:${battleId}` で管理する(battleId だけで重複除外すると片方の room が永久に未確定になる)。
// - コミットは確定処理と同じ commitBattleSnapshot を通す(sourceUpdatedAt の CAS 込み)。
//
// 使い方:
//   npx tsx scripts/backfill-battle-history.ts --dry-run    # 対象件数の見積もりのみ
//   npx tsx scripts/backfill-battle-history.ts              # 未確定のバトルだけ確定する
//   npx tsx scripts/backfill-battle-history.ts --force      # 確定済みも再計算する(CASは効く)
//
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { resolveBattleWindow } from "../src/lib/battle-history";
import { commitBattleSnapshot, computeBattleSnapshot } from "../src/lib/battle-history-finalize";

const TAG = "[backfill-battle-history]";

const BATCH_SIZE = 500;
/** 終了から24時間経っていないバトルは対象外(値がまだ静止していない可能性がある)。 */
const MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** バッチ間の小休止。本番DBへ連続で負荷をかけない。 */
const BATCH_SLEEP_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");

  const now = new Date();
  const cutoff = new Date(now.getTime() - MIN_AGE_MS);
  console.log(
    `${TAG} 開始${dryRun ? "(ドライラン)" : ""}${force ? "(確定済みも再計算)" : ""} / ` +
      `windowEnd <= ${cutoff.toISOString()} のバトルが対象`
  );

  const processedKeys = new Set<string>();
  let scanned = 0;
  let targets = 0;
  let created = 0;
  let updated = 0;
  let skippedAlreadyFinalized = 0;
  let skippedNotReady = 0;
  let skippedStale = 0;
  let failed = 0;

  let cursor: string | null = null;

  for (;;) {
    // where を明示的に型注釈する。findMany の引数へ cursor をそのまま書くと、cursor の型が
    // batch(この findMany の戻り値)から逆算されて循環し TS7022 になる。
    const batchWhere: Prisma.TiktokBattleWhereInput = cursor === null ? {} : { id: { gt: cursor } };
    const batch = await prisma.tiktokBattle.findMany({
      where: batchWhere,
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      // 重い列(hostProfiles / hostScores)は取らない。窓の判定に要る列だけ。
      select: {
        id: true,
        roomId: true,
        battleId: true,
        action: true,
        startedAt: true,
        startedAtEstimated: true,
        endedAt: true,
        durationSec: true,
        updatedAt: true,
      },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    scanned += batch.length;

    for (const row of batch) {
      const key = `${row.roomId}:${row.battleId}`;
      if (processedKeys.has(key)) continue;

      const windowInfo = resolveBattleWindow(row, now);
      if (windowInfo.status !== "finished" && windowInfo.status !== "cut_short") continue;
      if (windowInfo.window === null || windowInfo.window.end === null) continue;
      if (windowInfo.window.end.getTime() > cutoff.getTime()) continue;

      processedKeys.add(key);
      targets++;

      if (dryRun) continue;

      if (!force) {
        const existing = await prisma.battleHistory.findUnique({
          where: { roomId_battleId: { roomId: row.roomId, battleId: row.battleId } },
          select: { id: true },
        });
        if (existing) {
          skippedAlreadyFinalized++;
          continue;
        }
      }

      try {
        // 24時間以上前に終了しているので安定性チェック(60秒待って再計算)は省く。
        const snapshot = await computeBattleSnapshot(row.roomId, row.battleId, now);
        if (snapshot === null) {
          skippedNotReady++;
          continue;
        }
        const result = await commitBattleSnapshot(snapshot, new Date());
        if (result.finalized) {
          if (result.action === "created") created++;
          else updated++;
        } else {
          skippedStale++;
        }
      } catch (err) {
        failed++;
        console.error(`${TAG} 失敗 roomId=${row.roomId} battleId=${row.battleId}`, err);
      }
    }

    console.log(
      `${TAG} 進捗: 走査${scanned}件 / 対象${targets}件 / 作成${created} 更新${updated} ` +
        `既確定スキップ${skippedAlreadyFinalized} 確定条件を満たさずスキップ${skippedNotReady} ` +
        `CAS/競合でスキップ${skippedStale} 失敗${failed}`
    );

    if (batch.length < BATCH_SIZE) break;
    await sleep(BATCH_SLEEP_MS);
  }

  console.log(
    `${TAG} 完了${dryRun ? "(ドライラン: 書き込みなし)" : ""} — 走査${scanned}件 / 対象${targets}件 / ` +
      `作成${created} 更新${updated} 既確定スキップ${skippedAlreadyFinalized} ` +
      `確定条件を満たさずスキップ${skippedNotReady} CAS/競合でスキップ${skippedStale} 失敗${failed}`
  );

  // 個別行の失敗はcatchして継続するが、自動実行がexit code 0を「全件成功」と誤認しないよう、
  // 1件でも失敗していればプロセス全体を失敗扱いにする。
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
