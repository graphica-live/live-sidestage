import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveStreamerIdByOverlayToken } from "@/lib/overlay";
import { hashApiKey } from "@/lib/agency/agency";

export async function resolveStreamerByOverlayToken(req: NextRequest): Promise<{ id: string } | null> {
  const token = req.nextUrl.searchParams.get("token");
  const streamerId = await resolveStreamerIdByOverlayToken(token);
  return streamerId ? { id: streamerId } : null;
}

export async function resolveStreamerByApiKey(req: NextRequest): Promise<{ id: string; roomId: string | null } | null> {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return null;

  const streamer = await prisma.streamer.findUnique({
    where: { apiKey },
    select: { id: true, verified: true, roomId: true },
  });

  if (!streamer?.verified) return null;

  return { id: streamer.id, roomId: streamer.roomId };
}

// 事務所・企業向けAPIの認証。Streamerの verified(BIO認証)は配信者本人確認の仕組みで
// 事務所には無関係なため、ここでは「キーが一致し、かつ管理者に承認済み」であることを見る。
// APIキーはハッシュでしか保存していないため、受け取ったキーをハッシュして引き当てる。
export async function resolveAgencyByApiKey(
  req: NextRequest
): Promise<{ id: string; maxWatchTargets: number } | null> {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return null;

  const agency = await prisma.agency.findUnique({
    where: { apiKeyHash: hashApiKey(apiKey) },
    select: { id: true, approved: true, maxWatchTargets: true },
  });

  if (!agency?.approved) return null;

  return { id: agency.id, maxWatchTargets: agency.maxWatchTargets };
}
