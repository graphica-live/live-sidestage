import { NextRequest, NextResponse } from "next/server";
import { resolveStreamerByOverlayToken } from "@/lib/api-auth";
import { isOverlayKind } from "@/lib/overlay/kinds";
import { OVERLAY_KIND_SERVER } from "@/lib/overlay/server-kinds";
import { reviveSuspendedMonitoringForRoom } from "@/lib/mark-last-active";

// オーバーレイ表示用のスナップショット取得。**種類が増えてもこのファイルは触らない**
// (kinds.ts と server-kinds.ts に足せば載る)。
//
// URL は `/api/overlay/contribution?token=...` のまま。動的セグメントにしても
// 既存のパスにマッチするので、OBS 側・表示ページ側の変更は要らない。
// middleware の除外エントリ `api/overlay(?:/|$)` もパスで判定しているのでそのまま。
export async function GET(req: NextRequest, { params }: { params: { kind: string } }) {
  const kind = params.kind;
  if (!isOverlayKind(kind)) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  const streamer = await resolveStreamerByOverlayToken(req);
  if (!streamer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // OBSがオーバーレイURLへアクセスした = 配信者が実際に使っている証拠なので、
  // 監視停止状態(monitoringSuspended)を能動的に復活させる(fire-and-forget)。
  if (streamer.roomId) void reviveSuspendedMonitoringForRoom(streamer.roomId);

  const snapshot = await OVERLAY_KIND_SERVER[kind].buildSnapshot(streamer.id);
  if (!snapshot) return NextResponse.json({ error: "配信者情報が見つかりません。" }, { status: 404 });

  return NextResponse.json(snapshot);
}
