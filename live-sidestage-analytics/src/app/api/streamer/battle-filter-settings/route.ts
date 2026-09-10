import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { battleFilterSettingsServer } from "@/lib/battle-filter-settings.server";

async function resolveStreamerId(): Promise<
  { id: string } | { error: NextResponse }
> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const streamer = await prisma.streamer.findUnique({
    where: { principalId: session.user.id },
    select: { id: true },
  });
  if (!streamer) {
    return {
      error: NextResponse.json(
        { error: "配信者情報が見つかりません。" },
        { status: 404 },
      ),
    };
  }
  return { id: streamer.id };
}

export async function GET(_req: NextRequest) {
  const resolved = await resolveStreamerId();
  if ("error" in resolved) return resolved.error;

  const payload = await battleFilterSettingsServer.load(resolved.id);
  return NextResponse.json(payload);
}

export async function PATCH(req: NextRequest) {
  const resolved = await resolveStreamerId();
  if ("error" in resolved) return resolved.error;

  const body = await req.json().catch(() => ({}));
  const result = await battleFilterSettingsServer.patch(resolved.id, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result.payload);
}
