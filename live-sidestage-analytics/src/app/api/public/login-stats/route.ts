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

export async function GET() {
  const [streamerCount, contributorRows, giftCount, battleCount] = await Promise.all([
    prisma.streamer.count(),
    prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(DISTINCT "uniqueId") AS count FROM "gifts"`,
    prisma.gift.count(),
    prisma.tiktokBattle.count(),
  ]);

  return NextResponse.json(
    {
      streamerCount,
      contributorCount: Number(contributorRows[0]?.count ?? 0),
      giftCount,
      battleCount,
    },
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } }
  );
}
