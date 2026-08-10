import crypto from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { apiKey: true },
  });

  return NextResponse.json({ hasApiKey: Boolean(streamer?.apiKey) });
}

// APIキーを新規発行(または再発行)する。発行時のみ平文を返す。
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await prisma.streamer.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  if (!streamer) return NextResponse.json({ error: "配信者情報が見つかりません。" }, { status: 404 });

  const apiKey = crypto.randomBytes(32).toString("hex");

  await prisma.streamer.update({
    where: { id: streamer.id },
    data: { apiKey },
  });

  return NextResponse.json({ apiKey });
}
