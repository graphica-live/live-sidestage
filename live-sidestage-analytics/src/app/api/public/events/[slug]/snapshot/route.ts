import { NextRequest, NextResponse } from "next/server";
import { findPublicEvent, loadEventSnapshot, loadParticipantContributions } from "@/event/public-event";

// 公開ページのポーリング用。認証なし。
// middleware の matcher は /events と /api/events だけなので、ここは保護されない。

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const event = await findPublicEvent(params.slug);
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const participantId = req.nextUrl.searchParams.get("participantId");

  const [snapshot, participantContributions] = await Promise.all([
    loadEventSnapshot(event),
    participantId ? loadParticipantContributions(event.id, participantId) : Promise.resolve(null),
  ]);

  return NextResponse.json(
    {
      status: event.status,
      ...snapshot,
      participantContributions,
    },
    {
      // 集計は10秒間隔なので、それより短いキャッシュは意味がない。
      headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=10" },
    }
  );
}
