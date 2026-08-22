import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { findPublicEvent, loadEventSnapshot, loadParticipantContributions } from "@/event/public-event";

// 公開ページのポーリング用。認証は必須ではないが、非公開イベントをオーナーが
// プレビューできるようセッションがあれば読む。
// middleware の matcher は /events と /api/events だけなので、ここは保護されない。

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions);
  const event = await findPublicEvent(params.slug, session?.user?.id);
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
      // 非公開(オーナー限定)の応答は共有キャッシュに乗せない — visibility ごとに
      // 内容が変わる同一URLを public キャッシュに置くと、他人にオーナー限定の
      // データを配ってしまう。
      headers: {
        "Cache-Control":
          event.visibility === "PUBLIC"
            ? "public, max-age=5, stale-while-revalidate=10"
            : "private, no-store",
      },
    }
  );
}
