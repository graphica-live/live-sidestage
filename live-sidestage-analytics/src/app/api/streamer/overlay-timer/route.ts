import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  adjustTimerByMinutes,
  emitTimerAdHocEvent,
  emitTimerSnapshotUpdate,
  pauseTimer,
  resetTimer,
  startTimer,
} from "@/lib/overlay/timer.server";

// タイマーの手動操作(start/pause/reset/adjust/テスト再生)。
// **設定(overlay-settings/timer)とは別のAPI** — こちらは実行時状態の遷移で、
// 頻度・性質が異なるため分けてある。1本のPOSTでactionを振り分けるのは、
// 状態遷移として密結合(直列キューを共有する)ため。

async function resolveStreamerId(): Promise<{ id: string } | { error: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const streamer = await prisma.streamer.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!streamer) {
    return { error: NextResponse.json({ error: "配信者情報が見つかりません。" }, { status: 404 }) };
  }
  return { id: streamer.id };
}

export async function POST(req: NextRequest) {
  const resolved = await resolveStreamerId();
  if ("error" in resolved) return resolved.error;
  const streamerId = resolved.id;

  const body = await req.json().catch(() => ({}));

  switch (body.action) {
    case "start": {
      const runtime = await startTimer(streamerId);
      await emitTimerSnapshotUpdate(streamerId);
      return NextResponse.json({ runtime });
    }
    case "pause": {
      const runtime = await pauseTimer(streamerId);
      await emitTimerSnapshotUpdate(streamerId);
      return NextResponse.json({ runtime });
    }
    case "reset": {
      const runtime = await resetTimer(streamerId);
      await emitTimerSnapshotUpdate(streamerId);
      return NextResponse.json({ runtime });
    }
    case "adjust": {
      const deltaMinutes = Number(body.deltaMinutes);
      if (!Number.isFinite(deltaMinutes) || deltaMinutes === 0) {
        return NextResponse.json({ error: "deltaMinutesが不正です。" }, { status: 400 });
      }
      const { runtime, blocked, capped } = await adjustTimerByMinutes(streamerId, deltaMinutes);
      await emitTimerSnapshotUpdate(streamerId);
      await emitTimerAdHocEvent(streamerId, {
        type: blocked ? "blocked" : capped ? "capped" : "adjust",
        deltaMinutes,
        source: "manual",
        runtime,
      });
      return NextResponse.json({ runtime, blocked, capped });
    }
    case "test-end-sound":
      await emitTimerAdHocEvent(streamerId, { type: "test-sound", target: "end" });
      return NextResponse.json({ ok: true });
    case "test-countdown-sound":
      await emitTimerAdHocEvent(streamerId, { type: "test-sound", target: "countdown" });
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ error: "不明なactionです。" }, { status: 400 });
  }
}
