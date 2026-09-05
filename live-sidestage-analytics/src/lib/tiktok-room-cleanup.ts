import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getSetting } from "./settings";
import { fetchTiktokProfile, type TiktokProfileResult } from "./tiktok-profile";
import { roomHasPaidWatcher } from "./plan/room-has-paid-watcher";

// TikTok上に存在しなくなった(削除/改名された)可能性があるRoomの監視を一時停止する
// 日次バッチ(tiktok-cleanup.ts から呼ばれる)。worker-guardian.ts と同じ設計パターン
// (純粋関数 + オーケストレータ + kill switch + AppSetting監査ログ)を踏襲する。
//
// **データは一切削除しない。** 停止は TiktokRoom.monitoringSuspended を立てるだけで、
// Streamer/overlayToken/apiKey/Gift/BattleHistoryは全て残る
// (tiktok-low-value-cleanup.ts と同じ仕組み)。ユーザーが再ログイン・再アクセスすると
// markLastActive() が自動でフラグを戻し、次のreconcile(30秒間隔)で監視が復活する。
// 以前はStreamerごと削除する設計だったが、TikTok改名(uniqueId変更)は「打ち間違いで
// 最初から存在しないID」と同じNOT_FOUND応答になり、TikTok側での逆引きは無認証では
// 不可能なため、確定的な削除は取り返しがつかないリスクを持つと判断し撤回した。
// 監視停止であれば、判定が誤りだったとしても実害は無く(再ログインで即復活)、
// 判定が正しければ単に無駄な接続を試み続けなくなるだけ。
//
// 対象の絞り込みは TiktokRoom.listenerStatus が retrying/error に入ってから
// UNHEALTHY_THRESHOLD_MS 継続しているRoomのみ。全件毎回チェックはしない
// (fetchTiktokProfile() はプロキシなし単一データセンターIP頼りで、TikTok側の
// レート制限・bot判定を過度に刺激したくないため)。
//
// 停止確定は NOT_FOUND が NOT_FOUND_STREAK_REQUIRED 回連続、かつ NOT_FOUND_ELAPSED_MS 以上
// 経過した場合のみ。RATE_LIMITED/ERROR(判定不能)はストリークをリセットせず無視する —
// 字義通りリセットすると、TikTok側のレート制限が続く間は永久に連続回数を達成できない
// 自己矛盾が起きるため。
//
// 誤検出への防御(実装前レビューで指摘): NOT_FOUND判定は statusCode 単一シグナル頼りで、
// TikTok側のbot判定強化で休眠中の実在アカウントが一斉にNOT_FOUND化するリスクがある。
// そのため (1) run単位の停止件数上限(MAX_SUSPENSIONS_PER_RUN)、(2) run内NOT_FOUND率が
// 異常に高ければ停止を一切実行せず打ち切る、の2段構えで恒久的にガードする
// (データ削除ではなくなったため必須ではないが、無駄な接続断が大量発生するのを防ぐ
// 意味で維持する)。

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
// 旧環境変数名(TIKTOK_CLEANUP_MAX_DELETES_PER_RUN)からのリネーム(Code Modeレビューで指摘)。
// 本番に旧変数名が設定済みの場合に黙って既定値へ落ちないよう、新変数名が未設定なら
// 旧変数名にfallbackする。既定値はどちらも5で同一。
export const MAX_SUSPENSIONS_PER_RUN = Number(
  process.env.TIKTOK_CLEANUP_MAX_SUSPENSIONS_PER_RUN ?? process.env.TIKTOK_CLEANUP_MAX_DELETES_PER_RUN ?? 5
);
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
      monitoringSuspended: false,
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
  shouldSuspend: boolean;
  /**
   * TikTok が `user_not_found` を明示したか。hostUserId の補完を恒久的に諦める判断に使う。
   *
   * **`outcome === "not_found"` とは別物。** そちらは非 0 statusCode をまとめた粗い値で、
   * bot 判定や一時的な異常応答も含む(tiktok-profile.ts の `TiktokProfileResult` 参照)。
   * 監視停止はストリークと継続時間で守られているのでその粗さを許容できるが、
   * hostUserId の give-up は不可逆なので明示シグナルだけを根拠にする。
   */
  explicitNotFound: boolean;
};

/** fetchTiktokProfile()の結果からストリークを更新し、監視停止確定すべきかを判定する。純粋関数。 */
export function classifyExistenceResult(
  current: { notFoundStreak: number; notFoundFirstAt: Date | null },
  result: TiktokProfileResult,
  now: Date
): ExistenceClassification {
  if (result.ok) {
    return {
      notFoundStreak: 0,
      notFoundFirstAt: null,
      outcome: "exists",
      shouldSuspend: false,
      explicitNotFound: false,
    };
  }

  if (result.reason === "NOT_FOUND") {
    const notFoundFirstAt = current.notFoundStreak > 0 && current.notFoundFirstAt ? current.notFoundFirstAt : now;
    const notFoundStreak = current.notFoundStreak + 1;
    const elapsedMs = now.getTime() - notFoundFirstAt.getTime();
    const shouldSuspend = notFoundStreak >= NOT_FOUND_STREAK_REQUIRED && elapsedMs >= NOT_FOUND_ELAPSED_MS;
    return {
      notFoundStreak,
      notFoundFirstAt,
      outcome: "not_found",
      shouldSuspend,
      explicitNotFound: result.explicitNotFound === true,
    };
  }

  // RATE_LIMITED / ERROR: 判定不能として現状維持(増やしも減らしもしない)。
  return {
    notFoundStreak: current.notFoundStreak,
    notFoundFirstAt: current.notFoundFirstAt,
    outcome: "inconclusive",
    shouldSuspend: false,
    explicitNotFound: false,
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
      // TikTokが「そのユーザーはいない」と明示したなら、hostUserIdの補完も恒久的に諦める。
      //
      // **notFoundStreakと違って一方向で、connected復帰でも戻さない。** 改名で空いた
      // ハンドルを第三者が取得するとRoomは再びEXISTSになりstreakは0へ戻るが、そこで
      // 引ける数値userIdは第三者のもの。fill-onceなので一度入ると訂正できず、
      // 「このRoomの持ち主は第三者だ」という誤った証明として残り続ける
      // (詳細はschema.prismaのhostUserIdBackfillGaveUpAtのコメント)。
      //
      // 補完ジョブ(tiktok-host-id.ts)は自分が観測したNOT_FOUNDしか記録できないので、
      // 先にcleanupが観測したケースはここで拾わないと規律に穴が残る。
      ...(classification.explicitNotFound ? { hostUserIdBackfillGaveUpAt: checkedAt } : {}),
    },
  });
}

export type CleanupAuditEntry = {
  at: string;
  roomId: string;
  tiktokId: string;
  dryRun: boolean;
  outcome: "suspended" | "dry_run";
  notFoundStreak: number;
  notFoundFirstAt: string;
  giftCount: number;
  watcherCount: number;
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
 * NOT_FOUND確定したRoom1件ぶんの監視を停止する(dryRun時は監査ログのみ記録)。
 * データは削除しない — TiktokRoom.monitoringSuspended を立てるだけ。
 *
 * TOCTOU再確認: 選定〜ここまでの間にlistenerがconnected復帰していないか確認する。
 */
export async function suspendNotFoundRoom(
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

    // Streamerが0人(情報プール目的で監視継続中の部屋)でもここで弾かない。tiktok-low-value-cleanup.ts
    // と同じ扱い: userIds=[]ならroomHasPaidWatcherは常にfalseを返すので、課金ユーザー無しとして
    // 停止判定を続行する。
    const streamers = await tx.streamer.findMany({
      where: { roomId: room.id },
      select: { userId: true },
    });

    // 課金ユーザーが1人でも監視しているRoomは、TikTok上NOT_FOUND確定でも自動停止しない。
    if (await roomHasPaidWatcher(streamers.map((s) => s.userId), tx)) {
      console.warn(`[tiktok-cleanup] @${room.tiktokId} はNOT_FOUND確定だが課金ユーザーが監視中 — 自動停止せず要手動確認`);
      return null;
    }

    const entry: CleanupAuditEntry = {
      at: new Date().toISOString(),
      roomId: room.id,
      tiktokId: room.tiktokId,
      dryRun,
      outcome: dryRun ? "dry_run" : "suspended",
      notFoundStreak: fresh.notFoundStreak,
      notFoundFirstAt: fresh.notFoundFirstAt.toISOString(),
      giftCount,
      watcherCount: streamers.length,
    };

    if (!dryRun) {
      // monitoringSuspended:falseに加えlistenerStatusもWHEREへ含める(Code Modeレビューで指摘)。
      // ここまでのGift/Streamer/課金判定の間にlistenerがconnected復帰していても、
      // notFoundStreak/notFoundFirstAtの再確認だけでは検知できない。listenerStatusを
      // retrying/errorのまま再確認することで、復帰済みRoomを誤って停止する窓を防ぐ。
      await tx.tiktokRoom.updateMany({
        where: { id: room.id, monitoringSuspended: false, listenerStatus: { in: ["retrying", "error"] } },
        data: { monitoringSuspended: true },
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
      suspended: number;
      anomalyDetected: boolean;
      maxSuspensionsReached: boolean;
    };

/**
 * 1サイクルぶんの実在確認+(確定した分の)監視停止を実行する。
 *
 * 判定フェーズと停止フェーズを分離しているのは、NOT_FOUND率異常ガードを「停止を
 * 一切実行しない」形で機能させるため — 判定を先に全部集計してからガード判定し、
 * 異常なしのときだけ停止フェーズへ進む。
 */
export async function runCleanupCycle(opts: { dryRun: boolean; now?: Date }): Promise<CleanupCycleResult> {
  const now = opts.now ?? new Date();

  // kill switchが読めない間はfail-closedでスキップする。読み取り失敗をnullへ変換して
  // 「無効」とみなすと、緊急停止を設定済みでも一時的な読み取り障害の直後に監視を
  // 停止してしまいうる。
  let disabledSetting: string | null;
  try {
    disabledSetting = await getSetting(KILL_SWITCH_SETTING_KEY);
  } catch (err) {
    console.error("[tiktok-cleanup] kill switch の読み取りに失敗 — fail-closedでスキップ:", err);
    return { skipped: true };
  }
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

  let suspended = 0;
  let maxSuspensionsReached = false;

  if (anomalyDetected) {
    console.warn(
      `[tiktok-cleanup] NOT_FOUND率異常(${notFound}/${checked}) — TikTok側の広範な障害/bot判定強化を疑い、停止を一切実行せずrunを打ち切る`
    );
  } else {
    for (const { room, classification } of checkedResults) {
      if (!classification.shouldSuspend) continue;
      if (suspended >= MAX_SUSPENSIONS_PER_RUN) {
        maxSuspensionsReached = true;
        console.warn(`[tiktok-cleanup] run単位の停止件数上限(${MAX_SUSPENSIONS_PER_RUN})に到達 — 残りは次回runへ持ち越し`);
        break;
      }

      const entry = await suspendNotFoundRoom(room, opts.dryRun);
      if (!entry) continue;

      suspended++;
      console.warn(
        `[tiktok-cleanup] ${opts.dryRun ? "[DRY-RUN] " : ""}@${room.tiktokId} を非実在と確定 — ` +
          `監視${entry.watcherCount}件を${opts.dryRun ? "停止対象として記録" : "停止"} (giftCount: ${entry.giftCount})`
      );
    }
  }

  return {
    skipped: false,
    candidateCount: candidates.length,
    checked,
    exists,
    notFound,
    inconclusive,
    suspended,
    anomalyDetected,
    maxSuspensionsReached,
  };
}
