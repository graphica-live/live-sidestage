import { prisma } from "@/lib/prisma";
import { resolveAvatarUrls } from "@/lib/avatar-storage";
import { sanitizeAvatarUrl } from "@/lib/tiktok-profile";

export const RANKING_AVATAR_MAX_UIDS = 200;

export type RankingAvatarRow = { tiktokUid: string; profileImageUrl: string };

export function parseRankingAvatarUids(
  body: unknown
): { ok: true; uids: string[] } | { ok: false; error: string } {
  if (body === null || typeof body !== "object" || !("uids" in body)) {
    return { ok: false, error: "uids が不正です" };
  }
  const raw = (body as { uids: unknown }).uids;
  if (!Array.isArray(raw)) {
    return { ok: false, error: "uids が不正です" };
  }
  if (raw.length > RANKING_AVATAR_MAX_UIDS) {
    return { ok: false, error: "uids が不正です" };
  }
  const uids: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || item.length === 0) {
      return { ok: false, error: "uids が不正です" };
    }
    uids.push(item);
  }
  return { ok: true, uids };
}

/** この room の Gift / 日次ロールアップに出てきた uid だけ署名付きURLを返す。 */
export async function loadRankingAvatars(
  roomId: string,
  uids: string[]
): Promise<RankingAvatarRow[]> {
  if (uids.length === 0) return [];

  const uniqueUids = [...new Set(uids)];
  const [giftHits, rollupHits] = await Promise.all([
    prisma.gift.findMany({
      where: { roomId, tiktokUid: { in: uniqueUids } },
      distinct: ["tiktokUid"],
      select: { tiktokUid: true },
    }),
    prisma.giftDailyListenerStat.findMany({
      where: { roomId, tiktokUid: { in: uniqueUids } },
      distinct: ["tiktokUid"],
      select: { tiktokUid: true },
    }),
  ]);
  const allowed = new Set([...giftHits, ...rollupHits].map((row) => row.tiktokUid));
  const scopedUids = uniqueUids.filter((uid) => allowed.has(uid));
  if (scopedUids.length === 0) return [];

  const urls = await resolveAvatarUrls(scopedUids);
  const avatars: RankingAvatarRow[] = [];
  for (const tiktokUid of scopedUids) {
    const profileImageUrl = sanitizeAvatarUrl(urls.get(tiktokUid) ?? null);
    if (!profileImageUrl) continue;
    avatars.push({ tiktokUid, profileImageUrl });
  }
  return avatars;
}

/** 日付ナビの貢献ランキング。昨日以前はロールアップ、アバターは後埋め。 */
export const CALENDAR_RANKING_QUERY_OPTIONS = {
  preferRollup: true,
  resolveAvatars: false,
} as const;

/** custom 時刻範囲は日次ロールアップに載せない。アバターは後埋め。 */
export const CUSTOM_RANGE_RANKING_QUERY_OPTIONS = {
  preferRollup: false,
  resolveAvatars: false,
} as const;
