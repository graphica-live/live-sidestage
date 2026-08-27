import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isOverlayKind } from "@/lib/overlay/kinds";
import { OVERLAY_SETTINGS_SERVER } from "@/lib/overlay/settings-kinds";
import { emitOverlayUpdate } from "@/lib/overlay/emit";

// desktop 5ウィジェット移植で追加した新規kind専用の設定API。
// **contribution用の /api/streamer/overlay-settings は変更しない**(このルートは
// isOverlayKind && kind !== "contribution" の場合だけ扱う)。

function isSettingsKind(kind: string): kind is keyof typeof OVERLAY_SETTINGS_SERVER {
  return isOverlayKind(kind) && kind !== "contribution";
}

async function resolveStreamerId(): Promise<{ id: string } | { error: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const streamer = await prisma.streamer.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!streamer) {
    return { error: NextResponse.json({ error: "配信者情報が見つかりません。" }, { status: 404 }) };
  }
  return { id: streamer.id };
}

export async function GET(_req: NextRequest, { params }: { params: { kind: string } }) {
  if (!isSettingsKind(params.kind)) return NextResponse.json({ error: "Not Found" }, { status: 404 });

  const resolved = await resolveStreamerId();
  if ("error" in resolved) return resolved.error;

  const payload = await OVERLAY_SETTINGS_SERVER[params.kind].load(resolved.id);
  return NextResponse.json(payload);
}

export async function PATCH(req: NextRequest, { params }: { params: { kind: string } }) {
  if (!isSettingsKind(params.kind)) return NextResponse.json({ error: "Not Found" }, { status: 404 });

  const resolved = await resolveStreamerId();
  if ("error" in resolved) return resolved.error;

  const body = await req.json().catch(() => ({}));
  const result = await OVERLAY_SETTINGS_SERVER[params.kind].patch(resolved.id, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  emitOverlayUpdate(resolved.id, params.kind).catch((err) => console.error("[overlay] emit error:", err));

  return NextResponse.json(result.payload);
}
