import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashApiKey } from "@/lib/agency/agency";

// resolveStreamerIdByOverlayToken()(id のみ返す)ではなく直接1回のfindUniqueで
// roomIdまで取る(Code Modeレビューで指摘: 呼び出し元でid判明後にroomId目的で
// もう一度Streamerを取得する二重取得を避けるため)。
export async function resolveStreamerByOverlayToken(
  req: NextRequest
): Promise<{ id: string; roomId: string | null } | null> {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return null;

  // verified未完了でもオーバーレイは即時利用可能にする(コイン数/ギフト履歴の表示制限とは別軸)。
  const streamer = await prisma.streamer.findUnique({
    where: { overlayToken: token },
    select: { id: true, roomId: true },
  });

  return streamer;
}

export async function resolveStreamerByApiKey(req: NextRequest): Promise<{ id: string; roomId: string | null } | null> {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return null;

  // BIO認証(Streamer.verified)は前提にしない。verifiedを条件にすると、BIO認証を
  // どの機能の前提にもしない方針に反してTikEffect連携だけが未認証ユーザーへ閉じたままになる。
  //
  // **apiKeyの一致はTikTokアカウント所有の証明ではない。** tiktokIdの登録は無条件・
  // 重複可(他人のtiktokIdを登録すれば同じroomのapiKeyを誰でも取得できる)なので、
  // verifiedを課しても防御にはならない。ここで露出するデータ(月間MVP/TOP5の
  // uniqueId・nickname・avatar・コイン数)は、session認証の既存API(gifts等)でも
  // verified不問で取得できる水準であり、実質的な後退はない。
  const streamer = await prisma.streamer.findUnique({
    where: { apiKey },
    select: { id: true, roomId: true },
  });

  if (!streamer) return null;

  return { id: streamer.id, roomId: streamer.roomId };
}

// 事務所・企業向けAPIの認証。Streamerの verified(BIO認証)は配信者本人確認の仕組みで
// 事務所には無関係なため、ここではキーの一致だけを見る(事務所の存在自体が管理者による利用許可)。
// APIキーはハッシュでしか保存していないため、受け取ったキーをハッシュして引き当てる。
export async function resolveAgencyByApiKey(
  req: NextRequest
): Promise<{ id: string; maxWatchTargets: number } | null> {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return null;

  const agency = await prisma.agency.findUnique({
    where: { apiKeyHash: hashApiKey(apiKey) },
    select: { id: true, maxWatchTargets: true },
  });

  return agency ?? null;
}
