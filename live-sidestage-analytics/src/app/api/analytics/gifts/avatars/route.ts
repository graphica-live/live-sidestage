import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadRankingAvatars, parseRankingAvatarUids } from "@/lib/gift-ranking-avatars";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const streamer = await prisma.streamer.findUnique({
    where: { principalId: session.user.id },
    select: { roomId: true },
  });
  if (!streamer?.roomId) return json({ avatars: [] });

  const body = await req.json().catch(() => null);
  const parsed = parseRankingAvatarUids(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const avatars = await loadRankingAvatars(streamer.roomId, parsed.uids);
  return json({ avatars });
}
