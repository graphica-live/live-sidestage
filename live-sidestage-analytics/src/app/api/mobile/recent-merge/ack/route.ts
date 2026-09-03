import { NextRequest, NextResponse } from "next/server";
import { resolveActiveMobileUser } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { acknowledgeMergeLog } from "@/lib/tiktok-id-migration";

// mobile設定タブの事後通知SnackBarを閉じた操作の既読化。
export async function POST(req: NextRequest) {
  const auth = await resolveActiveMobileUser(req);
  if (!auth) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: auth.userId },
    select: { id: true },
  });
  if (!streamer) return NextResponse.json({ error: "配信者情報が見つかりません。" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const logId = body?.logId;
  if (typeof logId !== "string" || !logId) {
    return NextResponse.json({ error: "logId が必要です" }, { status: 400 });
  }

  await acknowledgeMergeLog(streamer.id, logId);
  return NextResponse.json({ ok: true });
}
