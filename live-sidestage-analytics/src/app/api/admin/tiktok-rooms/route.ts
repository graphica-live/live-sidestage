import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { deleteTiktokRoomPermanently, suspendRoomMonitoring } from "@/lib/tiktok-room";

// /admin/workers 管理画面からの TiktokRoom 完全削除・監視解除(一時停止)。
// GET /api/admin/workers は読み取り専用が設計上の不変条件のため、書き込み操作はこちらに分離する。

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roomId = new URL(req.url).searchParams.get("id");
  if (!roomId) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const result = await deleteTiktokRoomPermanently(roomId, session.user.email!);

  if (result === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (result === "event_active") {
    return NextResponse.json(
      { error: "開催中イベントの参加部屋のため削除できません" },
      { status: 409 }
    );
  }
  if (result === "lock_unavailable") {
    return NextResponse.json({ error: "他の処理と競合しています。時間をおいて再試行してください" }, { status: 409 });
  }
  return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const roomId = body?.id;
  const action = body?.action;
  if (typeof roomId !== "string" || action !== "suspend") {
    return NextResponse.json({ error: "id and action:\"suspend\" are required" }, { status: 400 });
  }

  const result = await suspendRoomMonitoring(roomId, session.user.email!);
  if (result === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
}
