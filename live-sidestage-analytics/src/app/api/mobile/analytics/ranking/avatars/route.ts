import { NextRequest, NextResponse } from "next/server";
import { resolveMobileAnalyticsContext } from "@/lib/mobile-auth";
import { resolveAvatarUrls } from "@/lib/avatar-storage";
import { sanitizeAvatarUrl } from "@/lib/tiktok-profile";
import { prisma } from "@/lib/prisma";

const MAX_UIDS = 200;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

const buildUnregisteredResponse = () => json({ avatars: [] });

function parseUids(body: unknown): { ok: true; uids: string[] } | { ok: false; error: string } {
  if (body === null || typeof body !== "object" || !("uids" in body)) {
    return { ok: false, error: "uids が不正です" };
  }
  const raw = (body as { uids: unknown }).uids;
  if (!Array.isArray(raw)) {
    return { ok: false, error: "uids が不正です" };
  }
  if (raw.length > MAX_UIDS) {
    return { ok: false, error: "uids が不正です" };
  }
  const uids: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || item.length === 0) {
      return { ok: false, error: "uids が不正です" };
    }
    uids.push(item);
  }
  return { ok: true, uids };
}

export async function POST(req: NextRequest) {
  const ctx = await resolveMobileAnalyticsContext(req, buildUnregisteredResponse);
  if (!ctx.ok) return ctx.response;

  const body = await req.json().catch(() => null);
  const parsed = parseUids(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  if (parsed.uids.length === 0) return json({ avatars: [] });

  const uniqueUids = [...new Set(parsed.uids)];
  const [giftHits, rollupHits] = await Promise.all([
    prisma.gift.findMany({
      where: { roomId: ctx.streamer.roomId, tiktokUid: { in: uniqueUids } },
      distinct: ["tiktokUid"],
      select: { tiktokUid: true },
    }),
    prisma.giftDailyListenerStat.findMany({
      where: { roomId: ctx.streamer.roomId, tiktokUid: { in: uniqueUids } },
      distinct: ["tiktokUid"],
      select: { tiktokUid: true },
    }),
  ]);
  const allowed = new Set([...giftHits, ...rollupHits].map((row) => row.tiktokUid));
  const scopedUids = uniqueUids.filter((uid) => allowed.has(uid));
  if (scopedUids.length === 0) return json({ avatars: [] });

  const urls = await resolveAvatarUrls(scopedUids);
  const avatars = [];
  for (const tiktokUid of scopedUids) {
    const rawUrl = urls.get(tiktokUid) ?? null;
    const profileImageUrl = sanitizeAvatarUrl(rawUrl);
    if (!profileImageUrl) continue;
    avatars.push({ tiktokUid, profileImageUrl });
  }

  return json({ avatars });
}
