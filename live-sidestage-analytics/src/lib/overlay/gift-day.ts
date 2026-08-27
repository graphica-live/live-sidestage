// その日のGiftを roomId+dayKey で全件取得する共通ヘルパー。**サーバー専用**(prisma を引く)。
// contribution / coin-list / top-gift が同じ取得パターンを使うため、ここへ集約する。

import { prisma } from "@/lib/prisma";

export type DayGift = {
  uniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  giftId: number;
  giftName: string;
  giftPictureUrl: string | null;
  diamondCount: number;
  totalDiamonds: number;
  receivedAt: Date;
};

export async function fetchDayGifts(roomId: string, dayKey: string): Promise<DayGift[]> {
  return prisma.gift.findMany({
    where: { roomId, dayKey },
    orderBy: { receivedAt: "asc" },
    select: {
      uniqueId: true,
      nickname: true,
      profileImageUrl: true,
      giftId: true,
      giftName: true,
      giftPictureUrl: true,
      diamondCount: true,
      totalDiamonds: true,
      receivedAt: true,
    },
  });
}
