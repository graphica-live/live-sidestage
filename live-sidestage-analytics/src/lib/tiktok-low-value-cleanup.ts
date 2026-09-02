import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getSetting } from "./settings";
import { roomHasPaidWatcher } from "./plan/room-has-paid-watcher";

// 配信自体は継続していても、課金ユーザーに見られておらずアクティブな無課金ユーザーも
// いない低価値なRoomの監視を一時停止する日次バッチ(tiktok-cleanup.ts から呼ばれる)。
// tiktok-room-cleanup.ts と同じ設計パターン(純粋関数+オーケストレータ+kill switch+
// AppSetting監査ログ)を踏襲するが、**データは一切削除しない**。
//
// 「削除」ではなく「監視停止(TiktokRoom.monitoringSuspended = true)」にとどめる。
// watchedRoomFilter()(tiktok-listener.ts)がこのフラグを見てWorker接続を切るだけで、
// Streamer/GiftEdit/overlayToken/apiKey/Gift/BattleHistoryは全て残る。ユーザーが
// 再ログイン・再アクセスすると markLastActive() が自動でフラグを戻し、次のreconcile
// (60秒間隔)で監視が復活する。不可逆な操作が無いため、既存のNOT_FOUND削除ほど
// 慎重な安全弁(needs_review・削除件数の異常検知)は必要ない。
//
// チェック順序は「安い判定→高い判定」。課金判定・アクティブ判定はインデックス済みの
// 一括IN取得(軽い)で先に済ませ、Gift集計(相対的に重い)は生き残った候補にのみ実行する。

export const ACTIVE_PROTECT_MS =
  Number(process.env.TIKTOK_LOW_VALUE_ACTIVE_PROTECT_DAYS ?? 90) * 86_400_000;
export const DIAMOND_LOOKBACK_MS =
  Number(process.env.TIKTOK_LOW_VALUE_LOOKBACK_DAYS ?? 30) * 86_400_000;
export const DIAMOND_THRESHOLD = Number(process.env.TIKTOK_LOW_VALUE_DIAMOND_THRESHOLD ?? 500_000);
export const CHECK_COOLDOWN_MS =
  Number(process.env.TIKTOK_LOW_VALUE_CHECK_COOLDOWN_DAYS ?? 7) * 86_400_000;
export const MAX_CHECKS_PER_RUN = Number(process.env.TIKTOK_LOW_VALUE_MAX_CHECKS_PER_RUN ?? 200);
export const MAX_SUSPENSIONS_PER_RUN = Number(process.env.TIKTOK_LOW_VALUE_MAX_SUSPENSIONS_PER_RUN ?? 20);

export const KILL_SWITCH_SETTING_KEY = "tiktokLowValueCleanupDisabled";
export const AUDIT_LOG_SETTING_KEY = "tiktokLowValueCleanupAuditLog";
const AUDIT_LOG_MAX_ENTRIES = 200;

/** kill switch(AppSetting)の値を解釈する。純粋関数。 */
export function isLowValueCleanupDisabled(settingValue: string | null): boolean {
  return settingValue === "true";
}

export type LowValueCandidate = { id: string; tiktokId: string; userIds: string[] };

/**
 * 監視停止判定の対象候補を抽出する。
 *
 * 除外条件: 事務所監視(AgencyWatch)中・イベント監視(monitorUntil)中・既に監視停止済み
 * のRoom。これらはリソースが解放されない(watchedRoomFilter()の他の条件で接続が
 * 維持され続ける)か、既に処理済みのため対象外にする。
 */
export async function selectLowValueCandidates(now: Date, limit: number): Promise<LowValueCandidate[]> {
  const cooldownCutoff = new Date(now.getTime() - CHECK_COOLDOWN_MS);

  const rooms = await prisma.tiktokRoom.findMany({
    where: {
      streamers: { some: {} },
      watches: { none: {} },
      monitoringSuspended: false,
      OR: [{ monitorUntil: null }, { monitorUntil: { lte: now } }],
      AND: [{ OR: [{ lastLowValueCheckAt: null }, { lastLowValueCheckAt: { lte: cooldownCutoff } }] }],
    },
    orderBy: { lastLowValueCheckAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { id: true, tiktokId: true, streamers: { select: { userId: true } } },
  });

  return rooms.map((r) => ({ id: r.id, tiktokId: r.tiktokId, userIds: r.streamers.map((s) => s.userId) }));
}

/** アクティブな無課金ユーザーがいるか判定する。純粋関数。lastActiveAtがnull(未記録)は保護扱い。 */
export function hasProtectedActiveWatcher(users: Array<{ lastActiveAt: Date | null }>, now: Date): boolean {
  const cutoff = now.getTime() - ACTIVE_PROTECT_MS;
  return users.some((u) => !u.lastActiveAt || u.lastActiveAt.getTime() >= cutoff);
}

export type LowValueAuditEntry = {
  at: string;
  roomId: string;
  tiktokId: string;
  dryRun: boolean;
  outcome: "suspended" | "dry_run";
  monthlyDiamonds: number;
  watcherCount: number;
};

async function appendLowValueAuditLog(tx: Prisma.TransactionClient, entry: LowValueAuditEntry): Promise<void> {
  const row = await tx.appSetting.findUnique({ where: { key: AUDIT_LOG_SETTING_KEY } });
  let list: LowValueAuditEntry[] = [];
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
 * 1件のRoomの監視を停止する(dryRun時は監査ログのみ記録、実際には停止しない)。
 *
 * TOCTOU再確認: 選定時のuserIds配列を使い回さず、この場でStreamerを再取得して
 * 課金・アクティブ判定をやり直す(選定〜ここまでの間に新規登録・ログインがあり
 * うるため)。ダイヤ合計もこの1Room分だけ再計算する(インデックス済みなので軽い)。
 *
 * 判定〜停止更新〜監査ログ記録をtiktok-room-cleanup.tsのsuspendNotFoundRoom()と同様に
 * 単一の$transactionへまとめる(実装後レビューで指摘)。個別awaitに分かれていると、
 * 判定直後に課金開始・新規Watcher追加・高額Gift受信が割り込む余地が広がる。
 * 完全なrow lockではないため理論上のレースを完全には排除しないが、既存の削除フローと
 * 同じ設計に揃えることでウィンドウを縮める。データ削除を伴わない(監視停止のみで
 * 再ログインで自動復活する)ため、tiktok-room-cleanup.tsほど厳密な排他は要求しない。
 */
export async function suspendLowValueRoom(
  room: { id: string; tiktokId: string },
  dryRun: boolean,
  now: Date = new Date()
): Promise<LowValueAuditEntry | null> {
  return prisma.$transaction(async (tx) => {
    const streamers = await tx.streamer.findMany({
      where: { roomId: room.id },
      select: { userId: true },
    });
    if (streamers.length === 0) return null;

    const userIds = streamers.map((s) => s.userId);

    if (await roomHasPaidWatcher(userIds, tx)) return null;

    const users = await tx.user.findMany({
      where: { id: { in: userIds } },
      select: { lastActiveAt: true },
    });
    if (hasProtectedActiveWatcher(users, now)) return null;

    const diamondSum = await tx.gift.aggregate({
      where: { roomId: room.id, receivedAt: { gte: new Date(now.getTime() - DIAMOND_LOOKBACK_MS) } },
      _sum: { totalDiamonds: true },
    });
    const monthlyDiamonds = diamondSum._sum.totalDiamonds ?? 0;
    if (monthlyDiamonds >= DIAMOND_THRESHOLD) return null;

    const entry: LowValueAuditEntry = {
      at: now.toISOString(),
      roomId: room.id,
      tiktokId: room.tiktokId,
      dryRun,
      outcome: dryRun ? "dry_run" : "suspended",
      monthlyDiamonds,
      watcherCount: userIds.length,
    };

    if (!dryRun) {
      // monitoringSuspended:falseをWHEREへ含め、選定〜ここまでの間に既に停止済み
      // (別runとの競合等)なら二重処理しない。
      await tx.tiktokRoom.updateMany({
        where: { id: room.id, monitoringSuspended: false },
        data: { monitoringSuspended: true },
      });
    }

    await appendLowValueAuditLog(tx, entry);
    return entry;
  });
}

export type LowValueCleanupCycleResult =
  | { skipped: true }
  | {
      skipped: false;
      candidateCount: number;
      checked: number;
      suspended: number;
      maxSuspensionsReached: boolean;
    };

/**
 * 1サイクルぶんの低価値Room監視停止判定+停止を実行する。
 */
export async function runLowValueCleanupCycle(opts: {
  dryRun: boolean;
  now?: Date;
}): Promise<LowValueCleanupCycleResult> {
  const now = opts.now ?? new Date();

  // kill switchが読めない間はfail-closedでスキップする(実装後レビューで指摘)。
  // 読み取り失敗をnullへ変換して「無効」とみなすと、緊急停止を設定済みでも一時的な
  // 読み取り障害の直後にRoomを停止してしまいうる。
  let disabledSetting: string | null;
  try {
    disabledSetting = await getSetting(KILL_SWITCH_SETTING_KEY);
  } catch (err) {
    console.error("[tiktok-low-value-cleanup] kill switch の読み取りに失敗 — fail-closedでスキップ:", err);
    return { skipped: true };
  }
  if (isLowValueCleanupDisabled(disabledSetting)) {
    console.log(`[tiktok-low-value-cleanup] kill switch有効(${KILL_SWITCH_SETTING_KEY}=true) — スキップ`);
    return { skipped: true };
  }

  const candidates = await selectLowValueCandidates(now, MAX_CHECKS_PER_RUN);

  let checked = 0;
  let suspended = 0;
  let maxSuspensionsReached = false;

  for (const room of candidates) {
    // run単位の停止件数上限に達したら、以後の候補は今回一切評価しない(実装後レビューで
    // 指摘)。lastLowValueCheckAtを書いてしまうとクールダウン期間(既定7日)だけ
    // 除外されてしまい、ログの「次回runへ持ち越し」という説明と矛盾する。
    if (suspended >= MAX_SUSPENSIONS_PER_RUN) {
      maxSuspensionsReached = true;
      break;
    }

    checked++;

    const entry = await suspendLowValueRoom(room, opts.dryRun, now);
    if (entry) {
      suspended++;
      console.warn(
        `[tiktok-low-value-cleanup] ${opts.dryRun ? "[DRY-RUN] " : ""}@${room.tiktokId} の監視を` +
          `${opts.dryRun ? "停止対象として記録" : "停止"} (直近${DIAMOND_LOOKBACK_MS / 86_400_000}日ダイヤ:${entry.monthlyDiamonds}, 視聴者:${entry.watcherCount}名)`
      );
    }

    // スキャンした全候補(生き残り・除外を問わず)にクールダウンローテーション用の
    // タイムスタンプを書く(既存tiktok-room-cleanup.tsのlastExistenceCheckAtと同じ理由)。
    await prisma.tiktokRoom.updateMany({
      where: { id: room.id },
      data: { lastLowValueCheckAt: now },
    });
  }

  if (maxSuspensionsReached) {
    console.warn(`[tiktok-low-value-cleanup] run単位の停止件数上限(${MAX_SUSPENSIONS_PER_RUN})に到達 — 残りは次回runへ持ち越し`);
  }

  return { skipped: false, candidateCount: candidates.length, checked, suspended, maxSuspensionsReached };
}
