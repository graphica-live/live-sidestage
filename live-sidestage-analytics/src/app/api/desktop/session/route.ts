import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveUserByDesktopToken } from "@/lib/desktop-auth";
import { activityOf } from "@/lib/listener-liveness";

export async function GET(req: NextRequest) {
  const auth = resolveUserByDesktopToken(req);
  if (!auth) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const streamer = await prisma.streamer.findUnique({
    where: { principalId: auth.principalId },
    select: {
      id: true,
      tiktokHandle: true,
      tiktokUid: true,
      verified: true,
      room: {
        select: {
          id: true,
          listenerStatus: true,
          listenerActivity: true,
          listenerMessage: true,
          listenerUpdatedAt: true,
          monitoringSuspended: true,
        },
      },
    },
  });

  if (!streamer) {
    return NextResponse.json({
      onboardingRequired: true,
      streamer: null,
      listener: null,
    });
  }

  const room = streamer.room;
  return NextResponse.json({
    onboardingRequired: false,
    streamer: {
      id: streamer.id,
      tiktokHandle: streamer.tiktokHandle,
      tiktokUid: streamer.tiktokUid,
      verified: streamer.verified,
    },
    listener: room
      ? {
          roomId: room.id,
          status: room.listenerStatus,
          activity: activityOf(room),
          message: room.listenerMessage,
          updatedAt: room.listenerUpdatedAt?.toISOString() ?? null,
          monitoringSuspended: room.monitoringSuspended,
        }
      : null,
  });
}