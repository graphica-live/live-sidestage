/** モバイル ranking avatars と同じ 1 リクエスト上限。サーバー RANKING_AVATAR_MAX_UIDS と揃える。 */
export const RANKING_AVATAR_BATCH = 200;

export type RankingAvatarUser = {
  tiktokUid: string;
  profileImageUrl: string | null;
};

export function rankingCacheKey(args: {
  apiBase: string;
  period: string;
  currentDate: string;
  customStart: string;
  customEnd: string;
}): string {
  const { apiBase, period, currentDate, customStart, customEnd } = args;
  if (period === "custom") return `${apiBase}|custom|${customStart}|${customEnd}`;
  return `${apiBase}|${period}|${currentDate}`;
}

export function chunkUids(uids: string[], size: number = RANKING_AVATAR_BATCH): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < uids.length; i += size) out.push(uids.slice(i, i + size));
  return out;
}

export function missingAvatarUids(users: RankingAvatarUser[]): string[] {
  return users.filter((u) => !u.profileImageUrl).map((u) => u.tiktokUid);
}

export function mergePreservedAvatars<T extends RankingAvatarUser>(previous: T[] | undefined, incoming: T[]): T[] {
  if (!previous?.length) return incoming;
  const urls = new Map<string, string>();
  for (const u of previous) {
    if (u.profileImageUrl) urls.set(u.tiktokUid, u.profileImageUrl);
  }
  return incoming.map((u) =>
    u.profileImageUrl ? u : { ...u, profileImageUrl: urls.get(u.tiktokUid) ?? null }
  );
}

export function applyAvatarUrls<T extends RankingAvatarUser>(
  users: T[],
  avatars: { tiktokUid: string; profileImageUrl: string }[]
): T[] {
  if (avatars.length === 0) return users;
  const map = new Map(avatars.map((a) => [a.tiktokUid, a.profileImageUrl]));
  return users.map((u) => {
    const url = map.get(u.tiktokUid);
    return url ? { ...u, profileImageUrl: url } : u;
  });
}

export function adjacentPrefetchDates(
  period: string,
  currentDate: string,
  today: string,
  navigate: (period: string, date: string, dir: -1 | 1) => string
): string[] {
  if (period === "custom") return [];
  const dates = [navigate(period, currentDate, -1)];
  const next = navigate(period, currentDate, 1);
  if (next <= today) dates.push(next);
  return dates;
}
