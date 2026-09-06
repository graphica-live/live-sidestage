import type { Prisma } from "@prisma/client";
import { getSetting } from "./settings";

// Worker が接続を維持すべき room の判定条件。tiktok-listener.ts の getMyRooms()・
// worker-status.ts の fetchAssignedRooms()・tiktok-room.ts の上限カウントが
// すべてこの1箇所を経由する(条件の乖離を防ぐため、実装は分岐させない)。
//
// 不変条件(既存 watched-room.integration.test.ts が固定): monitoringSuspended:true の
// roomでも、AgencyWatch または monitorUntil(イベント参加中)があれば監視対象であり続ける。
// AND(monitoringSuspended:false, OR[...]) のような形に組み替えると、この不変条件を壊す
// (実装前レビューで発見。設計ドラフト段階での事故)。必ず「OR of 連言」の形を保つこと。

export const ANONYMOUS_ROOM_AUTO_STOP_SETTING_KEY = "anonymousRoomAutoStopEnabled";

// 環境変数で上書き可能(worker-guardian.ts の BLOCKED_REASSIGN_THRESHOLD 等と同じパターン)。
// 不正値(未設定時のNaN・0以下)はデフォルト30分にフォールバックする。ここでNaNのまま
// new Date(NaN)がPrismaのwhereに入ると、トグルON時にgetMyRooms()が毎周回throwし
// 全workerのreconcileが止まる(fail-closed)ため、env誤設定1つで壊れないようにする。
const rawAutoStopTimeoutMs = Number(process.env.ANONYMOUS_ROOM_AUTO_STOP_TIMEOUT_MS);
export const ANONYMOUS_ROOM_AUTO_STOP_TIMEOUT_MS =
  Number.isFinite(rawAutoStopTimeoutMs) && rawAutoStopTimeoutMs > 0
    ? rawAutoStopTimeoutMs
    : 30 * 60_000;

/** kill switch(AppSetting)の値を解釈する。純粋関数。 */
export function isAnonymousRoomAutoStopEnabled(settingValue: string | null): boolean {
  return settingValue === "true";
}

export interface WatchedRoomFilterOptions {
  // null = トグルOFF相当(匿名roomも無条件で監視対象。現行動作と同一)。
  // Date = トグルON。この時刻以降にlastWatchInstructedAtが更新されていない匿名roomは対象外。
  anonymousStaleBefore: Date | null;
}

/**
 * 監視対象の判定条件。純粋関数(DBアクセスなし)。テストはこれを直接呼べる。
 *
 * 「Sidestageユーザーの室」(Streamer登録済み/AgencyWatch登録済み/イベント参加中)は
 * monitoringSuspended の値に関わらず無条件で監視対象。
 * それ以外の匿名観測room(コラボ検知等で発見されただけ)は、monitoringSuspended:false かつ
 * (トグルOFF、または最終監視指示が30分以内)の場合のみ監視対象。
 * 管理画面の「特別監視」(specialWatch:true)は匿名roomでもstale判定を免除する。
 * 免除しないと、自動停止トグルON環境で特別監視にしても lastWatchInstructedAt が古いままの
 * roomは監視対象に入らず、worker が接続しない(監視一時停止は特別監視より優先する)。
 */
export function watchedRoomFilter(
  now: Date = new Date(),
  opts: WatchedRoomFilterOptions = { anonymousStaleBefore: null }
): Prisma.TiktokRoomWhereInput {
  const anonymousRoomOk: Prisma.TiktokRoomWhereInput = opts.anonymousStaleBefore
    ? { lastWatchInstructedAt: { gt: opts.anonymousStaleBefore } }
    : {};

  return {
    OR: [
      { watches: { some: {} } },
      { monitorUntil: { gt: now } },
      { monitoringSuspended: false, streamers: { some: {} } },
      { monitoringSuspended: false, specialWatch: true },
      { monitoringSuspended: false, ...anonymousRoomOk },
    ],
  };
}

/**
 * AppSetting から自動停止トグルを読み、watchedRoomFilter() の opts を組み立てる。
 * getSetting() が失敗した場合は fail-open(トグルOFF相当、現行動作維持)にする —
 * reconcile 全体を止めて全room を切断させないため。
 */
export async function resolveWatchedRoomFilter(now: Date = new Date()): Promise<Prisma.TiktokRoomWhereInput> {
  let autoStopEnabled = false;
  try {
    autoStopEnabled = isAnonymousRoomAutoStopEnabled(await getSetting(ANONYMOUS_ROOM_AUTO_STOP_SETTING_KEY));
  } catch (err) {
    console.error("[watched-room-filter] 設定読み込みに失敗、自動停止を無効として扱う:", err);
  }

  return watchedRoomFilter(now, {
    anonymousStaleBefore: autoStopEnabled ? new Date(now.getTime() - ANONYMOUS_ROOM_AUTO_STOP_TIMEOUT_MS) : null,
  });
}
