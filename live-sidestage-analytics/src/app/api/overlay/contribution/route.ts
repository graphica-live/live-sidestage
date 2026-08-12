import { NextRequest, NextResponse } from "next/server";
import { resolveStreamerByOverlayToken } from "@/lib/api-auth";
import { buildOverlaySnapshot } from "@/lib/overlay";

export async function GET(req: NextRequest) {
  const streamer = await resolveStreamerByOverlayToken(req);
  if (!streamer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const snapshot = await buildOverlaySnapshot(streamer.id);
  if (!snapshot) return NextResponse.json({ error: "配信者情報が見つかりません。" }, { status: 404 });

  return NextResponse.json(snapshot);
}
