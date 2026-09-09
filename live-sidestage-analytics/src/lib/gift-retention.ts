// ギフト明細(Gift)の90日retention本体。
//
// 「ロールアップ → 未確定バトルの確定 → 削除」を1周回として実行する。エントリポイントは
// リポジトリ直下の gift-retention.ts(Railway Cron)。ここはテスト可能なロジック層。
//
// **設計上の不変条件(素朴な実装ではデータが欠ける。外部レビューで実際に見つかった経路)**:
//
// 1. **watermark 方式**。「直近N日だけ再集計」は、遅れて届いたギフト・バトル確定の補正を
//    取りこぼす。`gift_rollup_watermark_daykey` に「ロールアップ済みの上限 dayKey」を持ち、
//    そこから前へは進めない。
// 2. **upsert の下限は `max(watermark-2日, 削除カットオフ+1日)`**。単純に `watermark-2日`
//    から再計算すると、**既に一部行が削除済みの日**(イベント保護で一部だけ残った日を含む)を
//    再集計して過少値で上書きする。upsert 対象は「まだ1行も削除されていないことが保証された日」
//    だけに限る。そのために削除済みの上限 dayKey も `gift_retention_deleted_through_daykey`
//    として永続化する。
// 3. **削除は receivedAt ではなく dayKey 基準**。ロールアップが dayKey 単位なので、
//    削除も同じ単位に揃えないと「日をまたいだ部分削除」でその日の集計が二度と作れなくなる。
// 4. **watermark が削除対象に追いついていなければ削除しない**。cron が停滞した回に
//    「ロールアップされていない日」を消さないための最終ガード。
// 5. **未確定(`finalizedAt IS NULL`)イベントの参加room の Gift は消さない**。イベント集計は
//    開催期間の Gift を毎回フルスキャンで再計算する設計のため。確定後は
//    `reopenAggregation()` の締切ガード(終了+1週間)により恒久的に Gift を読まなくなるので、
//    保護は未確定の間だけでよい。
// 6. **バトル確定は削除より先**。確定処理(battle-history-finalize.ts)は Gift を読む。

import { prisma } from "@/lib/prisma";
import { commitBattleSnapshot, computeBattleSnapshot } from "@/lib/battle-history-finalize";
import {
  GIFT_RETENTION_DAYS,
  MIN_DAY_KEY,
  RETENTION_DELETED_THROUGH_KEY,
  ROLLUP_WATERMARK_KEY,
  dayKeyOf,
  readDayKeySetting,
  shiftDayKey,
} from "@/lib/gift-retention-window";

const TAG = "[gift-retention]";

/** 遅延補正(バトル確定・遅れて届いたギフト)を吸収するため、watermark から遡って再集計する日数。 */
const ROLLUP_LOOKBACK_DAYS = 2;

/** 1回の DELETE で消す行数。単一の巨大DELETEにするとロック時間とWALが膨らむ。 */
const DEFAULT_DELETE_BATCH_SIZE = 5000;

/** 1周回で確定を試みる未確定バトルの上限。 */
const MAX_BATTLE_FINALIZE_PER_CYCLE = 500;

export type GiftRetentionOptions = {
  /** true(既定)なら削除しない。件数だけ数えて報告する。 */
  dryRun?: boolean;
  /** watermark を無視して既存 Gift 全期間をロールアップし直す(初回有効化手順)。 */
  backfill?: boolean;
  now?: Date;
  deleteBatchSize?: number;
  /** 削除ステップを丸ごと省く(バックフィルだけ流したいとき)。 */
  skipDelete?: boolean;
};

export type GiftRetentionResult = {
  dryRun: boolean;
  rollup: {
    from: string | null;
    to: string | null;
    days: number;
    upsertedRows: number;
    watermarkBefore: string | null;
    watermarkAfter: string | null;
    /** watermark が「昨日」からどれだけ遅れているか。0でなければ cron が停滞している。 */
    watermarkLagDays: number;
    lifetimeRows: number;
  };
  battles: { pending: number; finalized: number; skipped: number };
  deletion: {
    cutoffDayKey: string;
    /** 実行を見送った理由。null なら実行した。 */
    skippedReason: string | null;
    deletedRows: number;
    /** 未確定イベントの保護で残した行数(dry-run時のみ数える)。 */
    protectedRows: number | null;
    deletedThroughAfter: string | null;
  };
};

/**
 * 削除を見送るべきか。**「ロールアップが追いついていない日は消さない」の判定はここ1箇所。**
 *
 * 現在の周回はロールアップ→削除を必ず同じプロセスで通すので通常は発火しないが、
 * ロールアップと削除を別ジョブへ分けたり、watermark 前進を条件付きにしたりした瞬間に
 * 効いてくる最後の砦。**外さないこと。**
 */
export function deletionSkipReason(
  watermark: string | null,
  maxDeletedDayKey: string
): string | null {
  if (watermark === null) return "ロールアップのwatermarkが未設定(バックフィル未完了)";
  if (watermark <= maxDeletedDayKey) {
    return `watermark(${watermark})が削除対象の最大dayKey(${maxDeletedDayKey})に追いついていない`;
  }
  return null;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** dayKey(JST の暦日)の開始時刻を UTC の Date で返す。 */
export function dayKeyStartUtc(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00+09:00`);
}

async function writeDayKeySetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

async function earliestGiftDayKey(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ dayKey: string | null }[]>`
    SELECT MIN("dayKey") AS "dayKey" FROM "gifts"
  `;
  return rows[0]?.dayKey ?? null;
}

/**
 * 1日ぶんのロールアップを作り直す。**その日の Gift 全件から作り直す(加算ではない)**ので、
 * 遅れて届いた行・バトル確定後の補正がそのまま反映される。
 *
 * 呼び出し側は「まだ1行も削除されていない日」だけを渡すこと(そうでないと過少値になる)。
 */
async function rollupDay(dayKey: string): Promise<number> {
  return prisma.$executeRawUnsafe(
    // 表示名(tiktokHandle / nickname / profileImageUrl)は採らない。正本は TikTokUser で、
    // tiktokUid から読み取り時に順引きする。array_agg による最新スナップショット採取も不要。
    `INSERT INTO public."gift_daily_listener_stats" AS t
       (id, "roomId", "dayKey", "tiktokUid",
        "rowCount", "giftCount", "totalDiamonds", "firstReceivedAt", "lastReceivedAt")
     SELECT gen_random_uuid()::text,
            g."roomId", g."dayKey", g."tiktokUid",
            COUNT(*)::int,
            COALESCE(SUM(g."repeatCount"), 0)::int,
            COALESCE(SUM(g."totalDiamonds"), 0)::int,
            MIN(g."receivedAt"),
            MAX(g."receivedAt")
       FROM public."gifts" g
      WHERE g."dayKey" = $1
      GROUP BY g."roomId", g."dayKey", g."tiktokUid"
     ON CONFLICT ("roomId", "dayKey", "tiktokUid") DO UPDATE SET
       "rowCount"        = EXCLUDED."rowCount",
       "giftCount"       = EXCLUDED."giftCount",
       "totalDiamonds"   = EXCLUDED."totalDiamonds",
       "firstReceivedAt" = EXCLUDED."firstReceivedAt",
       "lastReceivedAt"  = EXCLUDED."lastReceivedAt"`,
    dayKey
  );
}

/**
 * 全期間累計(GiftLifetimeStat)を日次ロールアップから作り直し、**同じトランザクションで**
 * watermark を前進させる。
 *
 * 分けると「watermark だけ進んで累計が古い」状態が残りうる。将来ここが重くなったら
 * 差分加算方式へ移せるが、そのときも watermark 更新との同一トランザクションは崩さないこと。
 */
async function recomputeLifetimeAndAdvanceWatermark(watermark: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const upserted = await tx.$executeRawUnsafe(
      `INSERT INTO public."gift_lifetime_stats" AS t
         ("tiktokUid", "rowCount", "giftCount", "totalDiamonds", "firstSeenAt", "lastSeenAt")
       SELECT s."tiktokUid",
              COALESCE(SUM(s."rowCount"), 0)::int,
              COALESCE(SUM(s."giftCount"), 0)::int,
              COALESCE(SUM(s."totalDiamonds"), 0)::bigint,
              MIN(s."firstReceivedAt"),
              MAX(s."lastReceivedAt")
         FROM public."gift_daily_listener_stats" s
        GROUP BY s."tiktokUid"
       ON CONFLICT ("tiktokUid") DO UPDATE SET
         "rowCount"      = EXCLUDED."rowCount",
         "giftCount"     = EXCLUDED."giftCount",
         "totalDiamonds" = EXCLUDED."totalDiamonds",
         "firstSeenAt"   = EXCLUDED."firstSeenAt",
         "lastSeenAt"    = EXCLUDED."lastSeenAt"`
    );

    // 日次側から消えた tiktokUid(room削除など)の残骸を落とす。
    await tx.$executeRawUnsafe(
      `DELETE FROM public."gift_lifetime_stats" l
        WHERE NOT EXISTS (
          SELECT 1 FROM public."gift_daily_listener_stats" s WHERE s."tiktokUid" = l."tiktokUid"
        )`
    );

    await tx.appSetting.upsert({
      where: { key: ROLLUP_WATERMARK_KEY },
      create: { key: ROLLUP_WATERMARK_KEY, value: watermark },
      update: { value: watermark },
    });

    return upserted;
  }, { timeout: 120_000, maxWait: 20_000 });
}

/**
 * 削除対象期間に残っている未確定バトルを先に確定する。
 *
 * 確定処理は Gift を読むので、**削除より必ず先**。90日前のバトルは値がとうに静止しているため、
 * `materializeBattleHistory()` の安定性チェック(既定10秒)は省いて `computeBattleSnapshot` を
 * 1回だけ呼ぶ(scripts/backfill-battle-history.ts と同じ判断)。
 */
async function finalizePendingBattles(
  cutoffDayKey: string,
  now: Date
): Promise<{ pending: number; finalized: number; skipped: number }> {
  const cutoffAt = dayKeyStartUtc(cutoffDayKey);
  // 購読なしroom(Streamer登録・AgencyWatch登録・specialWatch・monitorUntilのいずれも無い、
  // コラボ検知由来の匿名監視roomのみ)の未確定TiktokBattle行は最初から対象外にする。
  // computeBattleSnapshot側のガード(hasBattleSubscriber、battle-subscription.ts)と
  // 意味的に一致させること。これを入れないと購読なし行が恒久的に「pending」のまま残り、
  // LIMIT対象を占有して購読ありroomの未確定行を飢餓させるほか、countPendingBattles経由で
  // Gift削除処理そのものを永久停止させうる。
  const pending = await prisma.$queryRaw<{ roomId: string; battleId: string }[]>`
    SELECT b."roomId" AS "roomId", b."battleId" AS "battleId"
      FROM "tiktok_battles" b
     WHERE b."startedAt" < ${cutoffAt}
       AND NOT EXISTS (
         SELECT 1 FROM "battle_histories" h
          WHERE h."roomId" = b."roomId" AND h."battleId" = b."battleId"
       )
       AND EXISTS (
         SELECT 1 FROM "TiktokRoom" r
          WHERE r.id = b."roomId"
            AND (
              EXISTS (SELECT 1 FROM "Streamer" s WHERE s."roomId" = b."roomId")
              OR EXISTS (SELECT 1 FROM "AgencyWatch" w WHERE w."roomId" = b."roomId")
              OR r."specialWatch"
              OR (r."monitorUntil" IS NOT NULL AND r."monitorUntil" > ${now})
            )
       )
     ORDER BY b."startedAt" ASC
     LIMIT ${MAX_BATTLE_FINALIZE_PER_CYCLE}
  `;

  let finalized = 0;
  let skipped = 0;
  for (const row of pending) {
    try {
      const snapshot = await computeBattleSnapshot(row.roomId, row.battleId, now);
      if (!snapshot) {
        skipped += 1;
        continue;
      }
      const result = await commitBattleSnapshot(snapshot, now);
      if (result.finalized) finalized += 1;
      else skipped += 1;
    } catch (err) {
      // 1件の失敗で周回を止めない(確定は最適化であって正しさの前提ではない)。
      skipped += 1;
      console.warn(`${TAG} バトル確定に失敗 roomId=${row.roomId} battleId=${row.battleId}:`, err);
    }
  }

  return { pending: pending.length, finalized, skipped };
}

/**
 * カットオフより前の未確定バトル総数(LIMIT無し)。`finalizePendingBattles` は
 * 1周回 `MAX_BATTLE_FINALIZE_PER_CYCLE` 件までしか処理しないため、それを超えて
 * 残っている分もここで数え、削除をこの周回では見送る判断に使う。
 */
async function countPendingBattles(cutoffDayKey: string, now: Date): Promise<number> {
  const cutoffAt = dayKeyStartUtc(cutoffDayKey);
  // finalizePendingBattlesと同じ購読条件で除外する。ここで除外しないと、購読なしroomの
  // 恒久未確定行が常にpendingBattleCount>0を作り出し、Gift削除処理が全roomに対して
  // 永久停止する(CRITICAL、review-auto Design Modeで検出)。
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS "count"
      FROM "tiktok_battles" b
     WHERE b."startedAt" < ${cutoffAt}
       AND NOT EXISTS (
         SELECT 1 FROM "battle_histories" h
          WHERE h."roomId" = b."roomId" AND h."battleId" = b."battleId"
       )
       AND EXISTS (
         SELECT 1 FROM "TiktokRoom" r
          WHERE r.id = b."roomId"
            AND (
              EXISTS (SELECT 1 FROM "Streamer" s WHERE s."roomId" = b."roomId")
              OR EXISTS (SELECT 1 FROM "AgencyWatch" w WHERE w."roomId" = b."roomId")
              OR r."specialWatch"
              OR (r."monitorUntil" IS NOT NULL AND r."monitorUntil" > ${now})
            )
       )
  `;
  return Number(rows[0]?.count ?? 0);
}

/** 削除対象期間で未確定イベント保護に残った行数だけを数える(実行後ログ用)。 */
async function countProtectedRows(cutoffDayKey: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ protected: bigint }[]>`
    SELECT COUNT(*) AS "protected"
      FROM "gifts" g
     WHERE g."dayKey" < ${cutoffDayKey}
       AND EXISTS (
         SELECT 1 FROM event."EventParticipant" ep
           JOIN event."Event" e ON e."id" = ep."eventId"
          WHERE ep."roomId" = g."roomId" AND e."finalizedAt" IS NULL
       )
  `;
  return Number(rows[0]?.protected ?? 0);
}

/**
 * 削除対象の行数(未確定イベントの保護を除いたもの)を数える。dry-run 用。
 */
async function countDeletable(cutoffDayKey: string): Promise<{ deletable: number; protectedRows: number }> {
  const rows = await prisma.$queryRaw<{ deletable: bigint; protected: bigint }[]>`
    SELECT
      COUNT(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM event."EventParticipant" ep
          JOIN event."Event" e ON e."id" = ep."eventId"
         WHERE ep."roomId" = g."roomId" AND e."finalizedAt" IS NULL
      )) AS "deletable",
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM event."EventParticipant" ep
          JOIN event."Event" e ON e."id" = ep."eventId"
         WHERE ep."roomId" = g."roomId" AND e."finalizedAt" IS NULL
      )) AS "protected"
      FROM "gifts" g
     WHERE g."dayKey" < ${cutoffDayKey}
  `;
  return {
    deletable: Number(rows[0]?.deletable ?? 0),
    protectedRows: Number(rows[0]?.protected ?? 0),
  };
}

async function deleteInBatches(cutoffDayKey: string, batchSize: number): Promise<number> {
  let total = 0;
  for (;;) {
    const affected = await prisma.$executeRawUnsafe(
      `DELETE FROM public."gifts"
        WHERE id IN (
          SELECT g.id FROM public."gifts" g
           WHERE g."dayKey" < $1
             AND NOT EXISTS (
               SELECT 1 FROM event."EventParticipant" ep
                 JOIN event."Event" e ON e."id" = ep."eventId"
                WHERE ep."roomId" = g."roomId" AND e."finalizedAt" IS NULL
             )
           LIMIT $2
        )`,
      cutoffDayKey,
      batchSize
    );
    total += affected;
    if (affected < batchSize) break;
  }
  return total;
}

export async function runGiftRetentionCycle(
  options: GiftRetentionOptions = {}
): Promise<GiftRetentionResult> {
  const {
    dryRun = true,
    backfill = false,
    now = new Date(),
    deleteBatchSize = DEFAULT_DELETE_BATCH_SIZE,
    skipDelete = false,
  } = options;

  const today = dayKeyOf(now);
  const yesterday = shiftDayKey(today, -1);

  // --- 1. ロールアップ ---
  const watermarkBefore = await readDayKeySetting(ROLLUP_WATERMARK_KEY);
  const deletedThrough = await readDayKeySetting(RETENTION_DELETED_THROUGH_KEY);

  // **削除済みの日は再集計しない**(過少値で上書きしてしまう)。バックフィル/初回実行の
  // 分岐でもこのクランプを外さないこと — 外すと、削除は既に進んでいるのに watermark だけ
  // 未設定に戻した場合(手動復旧など)、削除済みの日を再集計して過少値で上書きしてしまう。
  const byDeleted = deletedThrough ? shiftDayKey(deletedThrough, 1) : MIN_DAY_KEY;
  let from: string | null;
  if (backfill || watermarkBefore === null) {
    const earliest = await earliestGiftDayKey();
    from = earliest === null ? null : earliest > byDeleted ? earliest : byDeleted;
  } else {
    const byLookback = shiftDayKey(watermarkBefore, -ROLLUP_LOOKBACK_DAYS);
    from = byLookback > byDeleted ? byLookback : byDeleted;
  }

  let upsertedRows = 0;
  let rollupFrom: string | null = null;
  let rollupTo: string | null = null;
  if (from !== null && from <= yesterday) {
    rollupFrom = from;
    rollupTo = yesterday;
    for (let day = from; day <= yesterday; day = shiftDayKey(day, 1)) {
      upsertedRows += await rollupDay(day);
    }
  }

  // Gift が1件も無い(=from が null)ときも watermark は「昨日」まで進めてよい。
  const watermarkAfter = yesterday;
  const lifetimeRows = await recomputeLifetimeAndAdvanceWatermark(watermarkAfter);
  const watermarkLagDays = watermarkBefore ? daysBetween(watermarkBefore, yesterday) : -1;

  const rollup = {
    from: rollupFrom,
    to: rollupTo,
    days: rollupFrom && rollupTo ? daysBetween(rollupFrom, rollupTo) + 1 : 0,
    upsertedRows,
    watermarkBefore,
    watermarkAfter,
    watermarkLagDays,
    lifetimeRows,
  };

  const cutoffDayKey = shiftDayKey(today, -GIFT_RETENTION_DAYS);
  const maxDeletedDayKey = shiftDayKey(cutoffDayKey, -1);

  if (skipDelete) {
    return {
      dryRun,
      rollup,
      battles: { pending: 0, finalized: 0, skipped: 0 },
      deletion: {
        cutoffDayKey,
        skippedReason: "skipDelete",
        deletedRows: 0,
        protectedRows: null,
        deletedThroughAfter: deletedThrough,
      },
    };
  }

  // --- 2. 削除より先に未確定バトルを確定する ---
  const battles = await finalizePendingBattles(cutoffDayKey, now);
  // `finalizePendingBattles` は1周回 MAX_BATTLE_FINALIZE_PER_CYCLE 件までしか処理しない。
  // それを超えて未確定バトルが残っている場合、削除側はバトル確定状態を一切見ずに進むため、
  // 確定を待たずに元Giftを消してしまう。残っている間はこの周回の削除を見送る。
  const pendingBattleCount = await countPendingBattles(cutoffDayKey, now);

  // --- 3. 削除 ---
  // **ロールアップが削除対象に追いついていなければ消さない。**
  // 判定は永続化された watermark を読み直して行う(このプロセスのメモリ上の値ではなく、
  // 実際にコミットされた値を根拠にする)。
  const persistedWatermark = await readDayKeySetting(ROLLUP_WATERMARK_KEY);
  const skipReason =
    pendingBattleCount > 0
      ? `未確定バトルが${pendingBattleCount}件残っている(1周回の確定上限${MAX_BATTLE_FINALIZE_PER_CYCLE}件超過。次回へ持ち越し)`
      : deletionSkipReason(persistedWatermark, maxDeletedDayKey);
  if (skipReason !== null) {
    return {
      dryRun,
      rollup,
      battles,
      deletion: {
        cutoffDayKey,
        skippedReason: skipReason,
        deletedRows: 0,
        protectedRows: null,
        deletedThroughAfter: deletedThrough,
      },
    };
  }

  if (dryRun) {
    const counted = await countDeletable(cutoffDayKey);
    return {
      dryRun,
      rollup,
      battles,
      deletion: {
        cutoffDayKey,
        skippedReason: null,
        deletedRows: counted.deletable,
        protectedRows: counted.protectedRows,
        deletedThroughAfter: deletedThrough,
      },
    };
  }

  const deletedRows = await deleteInBatches(cutoffDayKey, deleteBatchSize);
  await writeDayKeySetting(RETENTION_DELETED_THROUGH_KEY, maxDeletedDayKey);

  // 未確定イベントの保護で残った行数を観測用に記録する。無期限に保護され続ける
  // (=イベントが確定しない)room が積み上がっていないかは、この値の推移でしか気づけない。
  const protectedRows = await countProtectedRows(cutoffDayKey);
  if (protectedRows > 0) {
    console.warn(`${TAG} 未確定イベント保護により${protectedRows}件のGiftが削除対象から除外された`);
  }

  return {
    dryRun,
    rollup,
    battles,
    deletion: {
      cutoffDayKey,
      skippedReason: null,
      deletedRows,
      protectedRows,
      deletedThroughAfter: maxDeletedDayKey,
    },
  };
}
