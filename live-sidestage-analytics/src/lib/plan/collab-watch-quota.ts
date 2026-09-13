import { prisma } from "@/lib/prisma";
import { jstDateRangeToUtc } from "@/lib/battle-history";
import { dayKeyOf } from "@/lib/gift-retention-window";
import { hasFeatureAccess } from "./require-feature";
import type { TiktokRoomSubject } from "@/lib/tiktok-room";
import { normalizeTikTokUserId } from "@/lib/tiktok-user";

export const FREE_COLLAB_WATCH_SESSIONS_PER_DAY = 1;
export const FREE_COLLAB_OPPONENTS_PER_SESSION = 3;

// 複数worker同時の読取→書込はソフトリミット(tiktok-room.tsのMAX_COLLAB_DISCOVERED_ROOMSと同趣旨)。

export type CollabWatchQuotaState = {
  unlimited: boolean;
  remainingNewOpponents: number;
  sessionExhaustedToday: boolean;
  activeLinkCount: number;
  sessionOpponentCount: number;
};

async function resolveSessionOpponentUids(
  sourceRoomId: string,
  start: Date,
  end: Date,
  activeLinks: { watchedRoomId: string }[]
): Promise<Set<string>> {
  // 継続中セッションは TiktokRoomCollabSource を正とする。lastCollabSource* は別発見元で
  // 上書きされうるため、active 時にそちらだけ数えると枠を食い逃がす。
  if (activeLinks.length > 0) {
    const rooms = await prisma.tiktokRoom.findMany({
      where: { id: { in: activeLinks.map((l) => l.watchedRoomId) } },
      select: { hostTiktokUid: true },
    });
    return new Set(rooms.map((r) => r.hostTiktokUid));
  }
  const sessionOpponentRooms = await prisma.tiktokRoom.findMany({
    where: {
      lastCollabSourceRoomId: sourceRoomId,
      lastCollabSourceAt: { gte: start, lt: end },
    },
    select: { hostTiktokUid: true },
  });
  return new Set(sessionOpponentRooms.map((r) => r.hostTiktokUid));
}

async function principalIdsForStreamers(streamerIds: string[]): Promise<string[]> {
  if (streamerIds.length === 0) return [];
  const rows = await prisma.streamer.findMany({
    where: { id: { in: streamerIds } },
    select: { principalId: true },
  });
  return [...new Set(rows.map((r) => r.principalId))];
}

async function collabWatchUnlimitedForSubscribers(streamerIds: string[]): Promise<boolean> {
  const principalIds = await principalIdsForStreamers(streamerIds);
  if (principalIds.length === 0) return true;
  for (const principalId of principalIds) {
    const { allowed } = await hasFeatureAccess(principalId, "worker.collabOpponentWatch");
    if (allowed) return true;
  }
  return false;
}

export async function resolveCollabWatchQuota(
  streamerIds: string[],
  sourceRoomId: string
): Promise<CollabWatchQuotaState> {
  const unlimited = await collabWatchUnlimitedForSubscribers(streamerIds);
  const todayKey = dayKeyOf(new Date());
  const { start, end } = jstDateRangeToUtc("day", todayKey);

  const activeLinks = await prisma.tiktokRoomCollabSource.findMany({
    where: { sourceRoomId },
    select: { watchedRoomId: true },
  });
  const activeLinkCount = activeLinks.length;
  const sessionOpponentUids = await resolveSessionOpponentUids(
    sourceRoomId,
    start,
    end,
    activeLinks
  );
  const sessionOpponentCount = sessionOpponentUids.size;
  const sessionExhaustedToday = activeLinkCount === 0 && sessionOpponentCount > 0;

  if (unlimited) {
    return {
      unlimited: true,
      remainingNewOpponents: Number.POSITIVE_INFINITY,
      sessionExhaustedToday: false,
      activeLinkCount,
      sessionOpponentCount,
    };
  }

  let remainingNewOpponents = 0;
  if (sessionExhaustedToday) {
    remainingNewOpponents = 0;
  } else if (activeLinkCount > 0) {
    remainingNewOpponents = Math.max(0, FREE_COLLAB_OPPONENTS_PER_SESSION - sessionOpponentCount);
  } else {
    remainingNewOpponents = FREE_COLLAB_OPPONENTS_PER_SESSION;
  }

  return {
    unlimited: false,
    remainingNewOpponents,
    sessionExhaustedToday,
    activeLinkCount,
    sessionOpponentCount,
  };
}

export function applyCollabWatchQuotaToSubjects(
  subjects: TiktokRoomSubject[],
  quota: CollabWatchQuotaState,
  sessionOpponentUids: Set<string>
): TiktokRoomSubject[] {
  if (quota.unlimited) return subjects;

  const reattach: TiktokRoomSubject[] = [];
  const fresh: TiktokRoomSubject[] = [];
  for (const subject of subjects) {
    const tiktokUid = normalizeTikTokUserId(subject.tiktokUid);
    if (!tiktokUid) continue;
    if (sessionOpponentUids.has(tiktokUid)) reattach.push(subject);
    else fresh.push(subject);
  }

  const allowedFresh = fresh.slice(0, quota.remainingNewOpponents);
  return [...reattach, ...allowedFresh];
}

export async function filterCollabWatchSubjectsForQuota(
  streamerIds: string[],
  sourceRoomId: string,
  subjects: TiktokRoomSubject[]
): Promise<{ subjects: TiktokRoomSubject[]; quota: CollabWatchQuotaState }> {
  const quota = await resolveCollabWatchQuota(streamerIds, sourceRoomId);
  if (quota.unlimited) return { subjects, quota };

  const todayKey = dayKeyOf(new Date());
  const { start, end } = jstDateRangeToUtc("day", todayKey);
  const activeLinks = await prisma.tiktokRoomCollabSource.findMany({
    where: { sourceRoomId },
    select: { watchedRoomId: true },
  });
  const sessionOpponentUids = await resolveSessionOpponentUids(
    sourceRoomId,
    start,
    end,
    activeLinks
  );

  const filtered = applyCollabWatchQuotaToSubjects(subjects, quota, sessionOpponentUids);
  if (filtered.length < subjects.length) {
    console.info("[collab] FREE枠により相手roomの監視追加を制限", {
      sourceRoomId,
      requested: subjects.length,
      allowed: filtered.length,
      remainingNewOpponents: quota.remainingNewOpponents,
      sessionExhaustedToday: quota.sessionExhaustedToday,
      sessionOpponentCount: quota.sessionOpponentCount,
      activeLinkCount: quota.activeLinkCount,
    });
  }
  return { subjects: filtered, quota };
}
