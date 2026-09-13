import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveUserByDesktopToken } from "@/lib/desktop-auth";

export async function GET(req: NextRequest) {
  const auth = resolveUserByDesktopToken(req);
  if (!auth) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const streamer = await prisma.streamer.findUnique({
    where: { principalId: auth.principalId },
    select: { id: true },
  });
  if (!streamer) {
    return NextResponse.json({ error: "TikTokアカウントが未登録です" }, { status: 404 });
  }

  const rows = await prisma.tiktokGiftCatalog.findMany({
    select: {
      giftId: true,
      name: true,
      label: true,
      labelJa: true,
      diamondCount: true,
      imageUrl: true,
    },
    orderBy: [{ diamondCount: "asc" }, { name: "asc" }],
  });

  const gifts = rows.map((row) => ({
    id: String(row.giftId),
    name: row.name,
    nameJa: row.labelJa || row.label || row.name,
    imageUrl: row.imageUrl,
    diamondCount: row.diamondCount,
  }));

  return NextResponse.json({ gifts });
}