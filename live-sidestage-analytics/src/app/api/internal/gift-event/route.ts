import { NextRequest, NextResponse } from "next/server";
import { appendGiftLog, type GiftLogEntry } from "@/lib/tiktok-listener";
import { emitOverlaySnapshot } from "@/lib/overlay";

// Worker(worker.js)からWeb(server.js/global.__io)へgiftイベントを転送するための内部API。
// Railway private networking経由でのみ叩かれる想定 — INTERNAL_API_SECRET必須。
export async function POST(req: NextRequest) {
  const secret = process.env.INTERNAL_API_SECRET;
  const provided = req.headers.get("x-internal-secret");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    streamerId?: string;
    logEntry?: GiftLogEntry;
    emitOverlay?: boolean;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (body.logEntry) {
    appendGiftLog(body.logEntry);
  }

  if (body.emitOverlay && body.streamerId) {
    await emitOverlaySnapshot(body.streamerId).catch((err) =>
      console.error("[internal/gift-event] overlay emit error:", err)
    );
  }

  return NextResponse.json({ ok: true });
}
