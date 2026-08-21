import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

// LinkMic バトルの受信 payload を取り出す口。
//
// バトルの payload は実際の TikTok Live バトルでしか観測できず、tiktok-live-connector の
// 型定義(2.1.1-beta1、使用クラスは deprecated)と実物が一致する保証がない。
// 実配信で1回バトルを起こしてここから raw を取り出し、
// live-sidestage-event 側の fixture テストに差し込むために使う。
//
// **セッションでは開けない。** raw には対戦相手を含む他の配信者の情報が入るため、
// GIFT_LOG_TOKEN を持っている運用者だけが読めるようにする。

export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;

function tokenMatches(provided: string | null, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const envToken = process.env.GIFT_LOG_TOKEN;
  if (!envToken) {
    // token を設定していない環境ではこの口自体を無効にする。
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!tokenMatches(searchParams.get("token"), envToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.trunc(limitParam), 1), MAX_LIMIT)
    : 10;

  const tiktokId = searchParams.get("tiktokId")?.trim().replace(/^@/, "").toLowerCase();
  const battleId = searchParams.get("battleId")?.trim();

  const battles = await prisma.tiktokBattle.findMany({
    where: {
      ...(battleId ? { battleId } : {}),
      ...(tiktokId ? { room: { tiktokId } } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { room: { select: { tiktokId: true } } },
  });

  return NextResponse.json({
    count: battles.length,
    battles: battles.map((b) => ({
      roomId: b.roomId,
      tiktokId: b.room.tiktokId,
      battleId: b.battleId,
      action: b.action,
      startedAt: b.startedAt,
      startedAtEstimated: b.startedAtEstimated,
      endedAt: b.endedAt,
      durationSec: b.durationSec,
      hostUserIds: b.hostUserIds,
      hostDisplayIds: b.hostDisplayIds,
      hostScores: b.hostScores,
      updatedAt: b.updatedAt,
      raw: b.raw,
    })),
  });
}
