import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getSetting } from "./settings";
import { fetchTiktokProfile, type TiktokProfileResult } from "./tiktok-profile";
import { roomHasPaidWatcher } from "./plan/room-has-paid-watcher";

// TikTok上に存在しなくなった(削除/改名された)アカウントに紐づくStreamerを検出・削除する
// 日次バッチ(tiktok-cleanup.ts から呼ばれる)。worker-guardian.ts と同じ設計パターン
// (純粋関数 + オーケストレータ + kill switch + AppSetting監査ログ)を踏襲する。
//
// 対象の絞り込みは TiktokRoom.listenerStatus が retrying/error に入ってから
// UNHEALTHY_THRESHOLD_MS 継続しているRoomのみ。全件毎回チェックはしない
// (fetchTiktokProfile() はプロキシなし単一データセンターIP頼りで、TikTok側の
// レート制限・bot判定を過度に刺激したくないため)。
//
// 削除確定は NOT_FOUND が NOT_FOUND_STREAK_REQUIRED 回連続、かつ NOT_FOUND_ELAPSED_MS 以上
// 経過した場合のみ。RATE_LIMITED/ERROR(判定不能)はストリークをリセットせず無視する —
// 字義通りリセットすると、TikTok側のレート制限が続く間は永久に連続回数を達成できない
// 自己矛盾が起きるため。
//
// 誤検出への防御(実装前レビューで指摘): NOT_FOUND判定は statusCode 単一シグナル頼りで、
// TikTok側のbot判定強化で休眠中の実在アカウントが一斉にNOT_FOUND化するリスクがある。
// そのため (1) run単位の削除件数上限(MAX_DELETES_PER_RUN)、(2) run内NOT_FOUND率が
// 異常に高ければ削除を一切実行せず打ち切る、の2段構えで恒久的にガードする。
//
// さらに、TikTok改名(uniqueId変更)は「打ち間違いで最初から存在しないID」と同じNOT_FOUND
// 応答になり、TikTok側での逆引きは無認証では不可能(既存の手動スクリプト
// scripts/cleanup-nonexistent-streamers.ts で2026-08に実測済み)。したがって、NOT_FOUND確定
// 条件を満たしても、対象RoomにGift受信実績が1件でもあれば自動削除せず「要手動確認」として
// 監査ログに記録するだけに留める(少なくとも一度は実際に配信していた証拠があるため)。

export const UNHEALTHY_THRESHOLD_MS =
  Number(process.env.TIKTOK_CLEANUP_UNHEALTHY_DAYS ?? 30) * 86_400_000;
export const NOT_FOUND_STREAK_REQUIRED = Number(process.env.TIKTOK_CLEANUP_NOT_FOUND_STREAK ?? 3);
export const NOT_FOUND_ELAPSED_MS =
  Number(process.env.TIKTOK_CLEANUP_NOT_FOUND_ELAPSED_DAYS ?? 3) * 86_400_000;
export const CHECK_COOLDOWN_MS =
  Number(process.env.TIKTOK_CLEANUP_CHECK_COOLDOWN_HOURS ?? 20) * 3_600_000;
export const MAX_CHECKS_PER_RUN = Number(process.env.TIKTOK_CLEANUP_MAX_CHECKS_PER_RUN ?? 200);
export const CONCURRENCY = Number(process.env.TIKTOK_CLEANUP_CONCURRENCY ?? 2);
export const BATCH_DELAY_MS = Number(process.env.TIKTOK_CLEANUP_BATCH_DELAY_MS ?? 1000);
export const CIRCUIT_THRESHOLD = Number(process.env.TIKTOK_CLEANUP_CIRCUIT_THRESHOLD ?? 5);
export const MAX_DELETES_PER_RUN = Number(process.env.TIKTOK_CLEANUP_MAX_DELETES_PER_RUN ?? 5);
export const NOT_FOUND_RATE_GUARD_MIN_CHECKS = Number(
  process.env.TIKTOK_CLEANUP_NOT_FOUND_RATE_GUARD_MIN_CHECKS ?? 10
);
export const NOT_FOUND_RATE_GUARD_THRESHOLD = Number(
  process.env.TIKTOK_CLEANUP_NOT_FOUND_RATE_GUARD_THRESHOLD ?? 0.5
);

export const KILL_SWITCH_SETTING_KEY = "tiktokCleanupDisabled";
export const AUDIT_LOG_SETTING_KEY = "tiktokCleanupAuditLog";
const AUDIT_LOG_MAX_ENTRIES = 200;

/** kill switch(AppSetting)の値を解釈する。純粋関数。 */
export function isCleanupDisabled(settingValue: string | null): boolean {
  return settingValue === "true";
}

export type CleanupCandidate = {
  id: string;
  tiktokId: string;
  notFoundStreak: number;
  notFoundFirstAt: Date | null;
};

/**
 * 実在確認の対象候補を抽出する。
 *
 * NULLソート順に注意: PostgresのASCはNULLS LASTなので、`nulls: "first"`を明示しないと
 * 「未チェック優先」の意図と逆転する。クールダウン条件もOR句で明示しないと未チェック
 * (lastExistenceCheckAt===null)行が永久に候補から外れる。
 */
export async function selectCleanupCandidates(now: Date, limit: number): Promise<CleanupCandidate[]> {
  const unhealthyCutoff = new Date(now.getTime() - UNHEALTHY_THRESHOLD_MS);
  const cooldownCutoff = new Date(now.getTime() - CHECK_COOLDOWN_MS);

  return prisma.tiktokRoom.findMany({
    where: {
      listenerStatus: { in: ["retrying", "error"] },
      unhealthySince: { lte: unhealthyCutoff },
      streamers: { some: {} },
      OR: [{ lastExistenceCheckAt: null }, { lastExistenceCheckAt: { lte: cooldownCutoff } }],
    },
    orderBy: { lastExistenceCheckAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { id: true, tiktokId: true, notFoundStreak: true, notFoundFirstAt: true },
  });
}

export type ExistenceOutcome = "exists" | "not_found" | "inconclusive";

export type ExistenceClassification = {
  notFoundStreak: number;
  notFoundFirstAt: Date | null;
  outcome: ExistenceOutcome;
  shouldDelete: boolean;
};

/** fetchTiktokProfile()の結果からストリークを更新し、削除確定すべきかを判定する。純粋関数。 */
export function classifyExistenceResult(
  current: { notFoundStreak: number; notFoundFirstAt: Date | null },
  result: TiktokProfileResult,
  now: Date
): ExistenceClassification {
  if (result.ok) {
    return { notFoundStreak: 0, notFoundFirstAt: null, outcome: "exists", shouldDelete: false };
  }

  if (result.reason === "NOT_FOUND") {
    const notFoundFirstAt = current.notFoundStreak > 0 && current.notFoundFirstAt ? current.notFoundFirstAt : now;
    const notFoundStreak = current.notFoundStreak + 1;
    const elapsedMs = now.getTime() - notFoundFirstAt.getTime();
    const shouldDelete = notFoundStreak >= NOT_FOUND_STREAK_REQUIRED && elapsedMs >= NOT_FOUND_ELAPSED_MS;
    return { notFoundStreak, notFoundFirstAt, outcome: "not_found", shouldDelete };
  }

  // RATE_LIMITED / ERROR: 判定不能として現状維持(増やしも減らしもしない)。
  return {
    notFoundStreak: current.notFoundStreak,
    notFoundFirstAt: current.notFoundFirstAt,
    outcome: "inconclusive",
    shouldDelete: false,
  };
}

/**
 * 判定結果を条件付きupdateManyで書き込む。素朴なupdateだと、チェック中にリスナーが
 * connected復帰でリセットした値を古い読み値ベースで上書きする競合がありうるため、
 * listenerStatusがretrying/errorのままであることをWHERE句で再確認する。
 * 0件更新(競合発生)は次回の候補抽出で自然に外れるので無視してよい。
 */
async function recordExistenceCheck(
  roomId: string,
  classification: ExistenceClassification,
  checkedAt: Date
): Promise<void> {
  await prisma.tiktokRoom.updateMany({
    where: { id: roomId, listenerStatus: { in: ["retrying", "error"] } },
    data: {
      notFoundStreak: classification.notFoundStreak,
      notFoundFirstAt: classification.notFoundFirstAt,
      lastExistenceCheckAt: checkedAt,
    },
  });
}

export type CleanupAuditEntry = {
  at: string;
  roomId: string;
  tiktokId: string;
  dryRun: boolean;
  outcome: "deleted" | "needs_review" | "dry_run";
  notFoundStreak: number;
  notFoundFirstAt: string;
  giftCount: number;
  deletedStreamers: Array<{
    streamerId: string;
    userId: string;
    userEmail: string | null;
    tiktokIdEntered: string;
    verified: boolean;
    createdAt: string;
    hadApiKey: boolean;
    hadOverlayToken: boolean;
    giftEditCount: number;
  }>;
};

async function appendCleanupAuditLog(tx: Prisma.TransactionClient, entry: CleanupAuditEntry): Promise<void> {
  const row = await tx.appSetting.findUnique({ where: { key: AUDIT_LOG_SETTING_KEY } });
  let list: CleanupAuditEntry[] = [];
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  list.push(entry);
  const trimmed = list.slice(-AUDIT_LOG_MAX_ENTRIES);
  await tx.appSetting.upsert({
    where: { key: AUDIT_LOG_SETTING_KEY },
    create: { key: AUDIT_LOG_SETTING_KEY, value: JSON.stringify(trimmed) },
    update: { value: JSON.stringify(trimmed) },
  });
}

/**
 * NOT_FOUND確定したRoom1件ぶんの削除を実行する(dryRun時は監査ログのみ記録)。
 *
 * TOCTOU再確認: 選定〜ここまでの間にlistenerがconnected復帰していないか確認する。
 * Gift安全策: 受信済みGiftが1件でもあれば、TikTok改名の可能性を考慮して自動削除せず
 * "needs_review"として記録するだけに留める(既存の手動スクリプトから移植した安全策)。
 */
export async function deleteConfirmedRoom(
  room: { id: string; tiktokId: string },
  dryRun: boolean
): Promise<CleanupAuditEntry | null> {
  return prisma.$transaction(async (tx) => {
    const fresh = await tx.tiktokRoom.findUnique({
      where: { id: room.id },
      select: { notFoundStreak: true, notFoundFirstAt: true },
    });
    if (!fresh || fresh.notFoundStreak < NOT_FOUND_STREAK_REQUIRED || !fresh.notFoundFirstAt) {
      return null; // 途中で復帰済み。何もしない。
    }

    const giftCount = await tx.gift.count({ where: { roomId: room.id } });

    const streamers = await tx.streamer.findMany({
      where: { roomId: room.id },
      select: {
        id: true,
        userId: true,
        tiktokId: true,
        verified: true,
        createdAt: true,
        apiKey: true,
        overlayToken: true,
        user: { select: { email: true } },
        giftEdits: { select: { id: true } },
      },
    });
    if (streamers.length === 0) return null;

    // 課金ユーザーが1人でも監視しているRoomは、TikTok上NOT_FOUND確定でも自動削除しない。
    if (await roomHasPaidWatcher(streamers.map((s) => s.userId), tx)) {
      console.warn(`[tiktok-cleanup] @${room.tiktokId} はNOT_FOUND確定だが課金ユーザーが監視中 — 自動削除せず要手動確認`);
      return null;
    }

    const outcome: CleanupAuditEntry["outcome"] =
      giftCount > 0 ? "needs_review" : dryRun ? "dry_run" : "deleted";

    const entry: CleanupAuditEntry = {
      at: new Date().toISOString(),
      roomId: room.id,
      tiktokId: room.tiktokId,
      dryRun,
      outcome,
      notFoundStreak: fresh.notFoundStreak,
      notFoundFirstAt: fresh.notFoundFirstAt.toISOString(),
      giftCount,
      deletedStreamers: streamers.map((s) => ({
        streamerId: s.id,
        userId: s.userId,
        userEmail: s.user.email,
        tiktokIdEntered: s.tiktokId,
        verified: s.verified,
        createdAt: s.createdAt.toISOString(),
        hadApiKey: s.apiKey != null,
        hadOverlayToken: s.overlayToken != null,
        giftEditCount: s.giftEdits.length,
      })),
    };

    if (giftCount === 0 && !dryRun) {
      await tx.streamer.deleteMany({ where: { roomId: room.id } });
      // 将来同じtiktokIdで再登録されたときに古いフラグを引き継がないようクリアする。
      await tx.tiktokRoom.update({
        where: { id: room.id },
        data: { unhealthySince: null, notFoundStreak: 0, notFoundFirstAt: null, lastExistenceCheckAt: null },
      });
    }

    await appendCleanupAuditLog(tx, entry);
    return entry;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type CleanupCycleResult =
  | { skipped: true }
  | {
      skipped: false;
      candidateCount: number;
      checked: number;
      exists: number;
      notFound: number;
      inconclusive: number;
      deleted: number;
      needsReview: number;
      streamersDeleted: number;
      anomalyDetected: boolean;
      maxDeletesReached: boolean;
    };

/**
 * 1サイクルぶんの実在確認+(確定した分の)削除を実行する。
 *
 * 判定フェーズと削除フェーズを分離しているのは、NOT_FOUND率異常ガードを「削除を
 * 一切実行しない」形で機能させるため — 判定を先に全部集計してからガード判定し、
 * 異常なしのときだけ削除フェーズへ進む。
 */
export async function runCleanupCycle(opts: { dryRun: boolean; now?: Date }): Promise<CleanupCycleResult> {
  const now = opts.now ?? new Date();

  const disabledSetting = await getSetting(KILL_SWITCH_SETTING_KEY).catch((err) => {
    console.error("[tiktok-cleanup] kill switch の読み取りに失敗:", err);
    return null;
  });
  if (isCleanupDisabled(disabledSetting)) {
    console.log(`[tiktok-cleanup] kill switch有効(${KILL_SWITCH_SETTING_KEY}=true) — スキップ`);
    return { skipped: true };
  }

  const candidates = await selectCleanupCandidates(now, MAX_CHECKS_PER_RUN);

  const checkedResults: Array<{ room: CleanupCandidate; classification: ExistenceClassification }> = [];
  let checked = 0;
  let exists = 0;
  let notFound = 0;
  let inconclusive = 0;
  let consecutiveInconclusive = 0;

  batchLoop: for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (room) => {
        const result = await fetchTiktokProfile(room.tiktokId);
        const checkedAt = new Date();
        const classification = classifyExistenceResult(room, result, checkedAt);
        await recordExistenceCheck(room.id, classification, checkedAt);
        return { room, classification };
      })
    );

    for (const r of batchResults) {
      checked++;
      if (r.classification.outcome === "exists") {
        exists++;
        consecutiveInconclusive = 0;
      } else if (r.classification.outcome === "not_found") {
        notFound++;
        consecutiveInconclusive = 0;
      } else {
        inconclusive++;
        consecutiveInconclusive++;
      }
      checkedResults.push(r);
    }

    if (consecutiveInconclusive >= CIRCUIT_THRESHOLD) {
      console.warn(
        `[tiktok-cleanup] 判定不能が${CIRCUIT_THRESHOLD}件連続 — TikTok側の障害/制限を疑い、このrunを打ち切る`
      );
      break batchLoop;
    }

    if (i + CONCURRENCY < candidates.length) await sleep(BATCH_DELAY_MS);
  }

  const anomalyDetected =
    checked >= NOT_FOUND_RATE_GUARD_MIN_CHECKS && notFound / checked > NOT_FOUND_RATE_GUARD_THRESHOLD;

  let deleted = 0;
  let needsReview = 0;
  let streamersDeleted = 0;
  let maxDeletesReached = false;

  if (anomalyDetected) {
    console.warn(
      `[tiktok-cleanup] NOT_FOUND率異常(${notFound}/${checked}) — TikTok側の広範な障害/bot判定強化を疑い、削除を一切実行せずrunを打ち切る`
    );
  } else {
    for (const { room, classification } of checkedResults) {
      if (!classification.shouldDelete) continue;
      if (deleted >= MAX_DELETES_PER_RUN) {
        maxDeletesReached = true;
        console.warn(`[tiktok-cleanup] run単位の削除件数上限(${MAX_DELETES_PER_RUN})に到達 — 残りは次回runへ持ち越し`);
        break;
      }

      const entry = await deleteConfirmedRoom(room, opts.dryRun);
      if (!entry) continue;

      if (entry.outcome === "needs_review") {
        needsReview++;
        console.warn(
          `[tiktok-cleanup] @${room.tiktokId} はNOT_FOUND確定だがGift実績あり(${entry.giftCount}件) — 自動削除せず要手動確認`
        );
      } else {
        deleted++;
        streamersDeleted += entry.deletedStreamers.length;
        console.error(
          `[tiktok-cleanup] ${opts.dryRun ? "[DRY-RUN] " : ""}@${room.tiktokId} を非実在と確定 — ` +
            `Streamer ${entry.deletedStreamers.length}件${opts.dryRun ? "を削除対象として記録" : "を削除"} ` +
            `(userEmails: ${entry.deletedStreamers.map((s) => s.userEmail ?? "(unknown)").join(", ")})`
        );
      }
    }
  }

  return {
    skipped: false,
    candidateCount: candidates.length,
    checked,
    exists,
    notFound,
    inconclusive,
    deleted,
    needsReview,
    streamersDeleted,
    anomalyDetected,
    maxDeletesReached,
  };
}
