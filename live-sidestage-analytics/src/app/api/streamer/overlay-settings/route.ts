import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  emitOverlaySnapshot,
  generateOverlayToken,
  inferOverlayDisplayReference,
  jstDateKey,
  resolveOverlayDayKey,
  shiftDayKey,
} from "@/lib/overlay";

type OverlaySettingsResponse = {
  overlayToken: string;
  displayDate: string;
  isToday: boolean;
  threshold: number;
  goalCount: number;
  visibleRows: number;
  nameMaxWidth: number;
  align: string;
};

async function loadStreamer(userId: string) {
  return prisma.streamer.findUnique({
    where: { userId },
    select: {
      id: true,
      overlayToken: true,
      overlayDisplayReference: true,
      overlayDisplayDate: true,
      overlayThreshold: true,
      overlayGoalCount: true,
      overlayVisibleRows: true,
      overlayNameMaxWidth: true,
      overlayAlign: true,
    },
  });
}

function toResponse(streamer: {
  overlayToken: string | null;
  overlayDisplayReference: string;
  overlayDisplayDate: string | null;
  overlayThreshold: number;
  overlayGoalCount: number;
  overlayVisibleRows: number;
  overlayNameMaxWidth: number;
  overlayAlign: string;
}): OverlaySettingsResponse {
  const displayDate = resolveOverlayDayKey(streamer);
  return {
    overlayToken: streamer.overlayToken ?? "",
    displayDate,
    isToday: displayDate === jstDateKey(),
    threshold: streamer.overlayThreshold,
    goalCount: streamer.overlayGoalCount,
    visibleRows: streamer.overlayVisibleRows,
    nameMaxWidth: streamer.overlayNameMaxWidth,
    align: streamer.overlayAlign,
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let streamer = await loadStreamer(session.user.id);
  if (!streamer) return NextResponse.json({ error: "配信者情報が見つかりません。" }, { status: 404 });

  if (!streamer.overlayToken) {
    const overlayToken = generateOverlayToken();
    await prisma.streamer.update({ where: { id: streamer.id }, data: { overlayToken } });
    streamer = { ...streamer, overlayToken };
  }

  return NextResponse.json(toResponse(streamer));
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await loadStreamer(session.user.id);
  if (!streamer) return NextResponse.json({ error: "配信者情報が見つかりません。" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: {
    overlayDisplayReference?: string;
    overlayDisplayDate?: string | null;
    overlayThreshold?: number;
    overlayGoalCount?: number;
    overlayVisibleRows?: number;
    overlayNameMaxWidth?: number;
    overlayAlign?: string;
  } = {};

  if (body.nav === "prev" || body.nav === "next" || body.nav === "today") {
    if (body.nav === "today") {
      data.overlayDisplayReference = "today";
      data.overlayDisplayDate = null;
    } else {
      const currentDayKey = resolveOverlayDayKey(streamer);
      const offset = body.nav === "prev" ? -1 : 1;
      let nextDayKey = shiftDayKey(currentDayKey, offset);
      const today = jstDateKey();
      if (nextDayKey > today) nextDayKey = today;

      data.overlayDisplayReference = inferOverlayDisplayReference(nextDayKey);
      data.overlayDisplayDate = nextDayKey;
    }
  }

  if (body.threshold !== undefined) {
    const threshold = Number(body.threshold);
    if (!Number.isInteger(threshold) || threshold < 100 || threshold % 100 !== 0) {
      return NextResponse.json({ error: "閾値は100以上100の倍数で指定してください。" }, { status: 400 });
    }
    data.overlayThreshold = threshold;
  }

  if (body.goalCount !== undefined) {
    const goalCount = Number(body.goalCount);
    if (!Number.isInteger(goalCount) || goalCount < 0) {
      return NextResponse.json({ error: "目標人数は0以上の整数で指定してください。" }, { status: 400 });
    }
    data.overlayGoalCount = goalCount;
  }

  if (body.visibleRows !== undefined) {
    const visibleRows = Number(body.visibleRows);
    if (!Number.isInteger(visibleRows) || visibleRows < 1) {
      return NextResponse.json({ error: "表示人数は1以上の整数で指定してください。" }, { status: 400 });
    }
    data.overlayVisibleRows = visibleRows;
  }

  if (body.nameMaxWidth !== undefined) {
    const nameMaxWidth = Number(body.nameMaxWidth);
    if (!Number.isInteger(nameMaxWidth) || nameMaxWidth < 40) {
      return NextResponse.json({ error: "名前の最大幅は40px以上の整数で指定してください。" }, { status: 400 });
    }
    data.overlayNameMaxWidth = nameMaxWidth;
  }

  if (body.align !== undefined) {
    if (body.align !== "left" && body.align !== "right") {
      return NextResponse.json({ error: "整列方向はleftまたはrightで指定してください。" }, { status: 400 });
    }
    data.overlayAlign = body.align;
  }

  const updated = await prisma.streamer.update({
    where: { id: streamer.id },
    data,
    select: {
      overlayToken: true,
      overlayDisplayReference: true,
      overlayDisplayDate: true,
      overlayThreshold: true,
      overlayGoalCount: true,
      overlayVisibleRows: true,
      overlayNameMaxWidth: true,
      overlayAlign: true,
    },
  });

  emitOverlaySnapshot(streamer.id).catch((err) => console.error("[overlay] emit error:", err));

  return NextResponse.json(toResponse(updated));
}
