// その日のGiftを roomId+dayKey で全件取得する共通ヘルパー。**サーバー専用**(prisma を引く)。
// contribution / coin-list / top-gift が同じ取得パターンを使うため、ここへ集約する。
//
// **Giftは表示用の列(tiktokHandle / nickname / profileImageUrl)を持たない。** 同一性キーは
// 不変の tiktokUid で、表示名は TikTokUser から、アイコンは TiktokAvatarAsset から
// 読み出し時に順引きする(ハンドル改名でタリーが割れないのが要点)。

import { prisma } from "@/lib/prisma";
import { resolveTikTokUserDisplay } from "@/lib/tiktok-user";
import { resolveAvatarUrls } from "@/lib/avatar-storage";

export type DayGift = {
  tiktokUid: string;
  tiktokHandle: string | null;
  nickname: string | null;
  profileImageUrl: string | null;
  giftId: number;
  giftName: string;
  giftPictureUrl: string | null;
  diamondCount: number;
  totalDiamonds: number;
  receivedAt: Date;
};

export async function fetchDayGifts(roomId: string, dayKey: string): Promise<DayGift[]> {
  const rows = await prisma.gift.findMany({
    where: { roomId, dayKey },
    orderBy: { receivedAt: "asc" },
    select: {
      tiktokUid: true,
      giftId: true,
      giftName: true,
      giftPictureUrl: true,
      diamondCount: true,
      totalDiamonds: true,
      receivedAt: true,
    },
  });
  if (rows.length === 0) return [];

  const tiktokUids = [...new Set(rows.map((r) => r.tiktokUid))];
  const [display, avatars] = await Promise.all([
    resolveTikTokUserDisplay(tiktokUids),
    resolveAvatarUrls(tiktokUids),
  ]);

  return rows.map((r) => ({
    ...r,
    tiktokHandle: display.get(r.tiktokUid)?.tiktokHandle ?? null,
    nickname: display.get(r.tiktokUid)?.nickname ?? null,
    profileImageUrl: avatars.get(r.tiktokUid) ?? null,
  }));
}
