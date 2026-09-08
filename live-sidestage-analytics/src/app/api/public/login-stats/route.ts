import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ログイン画面(/login)の実績訴求用。未認証で見えるため個人情報は含めない。
// 集計対象は登録全体で軽くないため、CDN/ブラウザ両方に5分キャッシュさせる。
//
// force-dynamicが無いとNext.jsがビルド時にこのルートを静的プリレンダリングしようとし、
// Dockerfileのビルド時DATABASE_URL(到達不能なダミー値)でPrismaクエリが失敗して
// `next build` ごと落ちる(他のPrismaを叩くAPI routeが全て force-dynamic を宣言しているのはこのため)。
export const dynamic = "force-dynamic";
export const revalidate = 300;

/**
 * 全期間累計は `GiftLifetimeStat`(gift-retention.ts が日次で作り直す)から読む。
 * 明細(Gift)は90日で削除されるので、フルスキャンでは過去ぶんを数えられない。
 *
 * `giftCount` は現行どおり**行数**(`prisma.gift.count()` 相当)なので `rowCount` を使う。
 * ロールアップの `giftCount`(repeatCount合計)とは意味が違うので取り違えないこと。
 *
 * バックフィル前(=ロールアップ0件)は従来のフルスキャンへフォールバックする。
 * 有効化の途中で数字が0に落ちないための保険で、バックフィル後は分岐しない。
 */
async function loadGiftTotals(): Promise<{ contributorCount: number; giftCount: number }> {
  const [contributorCount, sums] = await Promise.all([
    prisma.giftLifetimeStat.count(),
    prisma.giftLifetimeStat.aggregate({ _sum: { rowCount: true } }),
  ]);

  if (contributorCount > 0) {
    return { contributorCount, giftCount: sums._sum.rowCount ?? 0 };
  }

  const [rows, giftCount] = await Promise.all([
    prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(DISTINCT "tiktokUid") AS count FROM "gifts"`,
    prisma.gift.count(),
  ]);
  return { contributorCount: Number(rows[0]?.count ?? 0), giftCount };
}

export async function GET() {
  // 「監視中」の実数はStreamer(登録ユーザー)行数ではなくTiktokRoom(実際に接続している部屋)数。
  // コラボ自己申告等でStreamer登録なしにTiktokRoomだけ存在するケースがあるため、
  // streamer.count()だと監視中の部屋数より少なく出る。
  const [roomCount, giftTotals, battleCount] = await Promise.all([
    prisma.tiktokRoom.count(),
    loadGiftTotals(),
    prisma.tiktokBattle.count(),
  ]);

  return NextResponse.json(
    {
      roomCount,
      contributorCount: giftTotals.contributorCount,
      giftCount: giftTotals.giftCount,
      battleCount,
    },
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } }
  );
}
