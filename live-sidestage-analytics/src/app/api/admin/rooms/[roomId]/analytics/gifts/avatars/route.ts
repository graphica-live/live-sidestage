import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { loadRankingAvatars, parseRankingAvatarUids } from "@/lib/gift-ranking-avatars";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest, { params }: { params: { roomId: string } }) {
  const session = await getAdminSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  const parsed = parseRankingAvatarUids(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const avatars = await loadRankingAvatars(params.roomId, parsed.uids);
  return json({ avatars });
}
