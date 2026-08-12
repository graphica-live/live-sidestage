import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveStreamerIdByOverlayToken } from "@/lib/overlay";

export async function resolveStreamerByOverlayToken(req: NextRequest): Promise<{ id: string } | null> {
  const token = req.nextUrl.searchParams.get("token");
  const streamerId = await resolveStreamerIdByOverlayToken(token);
  return streamerId ? { id: streamerId } : null;
}

export async function resolveStreamerByApiKey(req: NextRequest): Promise<{ id: string } | null> {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return null;

  const streamer = await prisma.streamer.findUnique({
    where: { apiKey },
    select: { id: true, verified: true },
  });

  if (!streamer?.verified) return null;

  return { id: streamer.id };
}
