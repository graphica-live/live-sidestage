import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { findPublicEvent, loadBracket } from "@/event/public-event";

// 公開トーナメント表のポーリング用。
//
// **ページ全体を読み直す(`router.refresh()`)代わりにこれを引く。** `/e/[slug]` は
// `force-dynamic` なので、refresh すると順位表のスナップショット5クエリやバトルスコアまで
// 毎回引き直すことになる。しかも順位表は `EventResults` が別途ポーリングしていて、
// RSC から渡し直した `initial` は `useState` の初期値にしか使われない(＝完全な無駄打ち)。
//
// 認証は必須ではないが、非公開イベントをオーナーがプレビューできるようセッションがあれば読む。
// middleware の matcher は /events と /api/events だけなので、ここは保護されない。

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions);
  const event = await findPublicEvent(params.slug, session?.user?.id);
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const bracket = event.format === "TOURNAMENT" ? await loadBracket(event.id) : null;

  return NextResponse.json(
    {
      status: event.status,
      // ポーリングの停止条件。**クライアントは毎回これで判断し直す** — 初期 props で
      // 固定すると、開いたままイベントが始まった/確定したときに追随できない。
      finalizedAt: event.finalizedAt?.toISOString() ?? null,
      // 表が未作成・トーナメント以外なら null。クライアントはこれを見て空状態へ戻す
      // (破棄 → 作り直しは実際に運用される導線なので、両方向とも動くこと)。
      bracket,
    },
    {
      // 集計は10秒間隔なので、それより短いキャッシュは意味がない。
      // 非公開(オーナー限定)の応答は共有キャッシュに乗せない — snapshot API と同じ理由。
      headers: {
        "Cache-Control":
          event.visibility === "PUBLIC"
            ? "public, max-age=5, stale-while-revalidate=10"
            : "private, no-store",
      },
    }
  );
}
