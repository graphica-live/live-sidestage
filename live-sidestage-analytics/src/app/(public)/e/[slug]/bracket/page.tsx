import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { findPublicEvent, loadBracket } from "@/event/public-event";
import { CARD_CLIP } from "../battle-ui";
import { BracketLive } from "./BracketLive";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const session = await getServerSession(authOptions);
  const event = await findPublicEvent(params.slug, session?.user?.id);
  if (!event) return { title: "見つかりません" };
  return {
    title: `${event.title} — トーナメント表`,
    robots: event.visibility === "PUBLIC" ? undefined : { index: false, follow: false },
  };
}

export default async function BracketPage({ params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions);
  const event = await findPublicEvent(params.slug, session?.user?.id);
  if (!event) notFound();

  const bracket = event.format === "TOURNAMENT" ? await loadBracket(event.id) : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Link
        href={`/e/${event.slug}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand"
      >
        ← {event.title}
      </Link>
      <h1 className="mt-3 flex items-center gap-2.5 font-[family-name:var(--font-battle)] text-2xl font-black tracking-tight text-strong md:text-3xl">
        <span className="h-6 w-2 shrink-0 -skew-x-12 bg-brand" aria-hidden />
        トーナメント表
      </h1>

      {event.format !== "TOURNAMENT" ? (
        <p className={`mt-6 border border-dashed border-border p-4 text-sm text-muted ${CARD_CLIP}`}>
          この種目にトーナメント表はない。
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">
            最終的な勝敗は実際のバトルスコアおよび運営判断で決定する。
          </p>

          {/* 決勝を中央に置き、左右へブロックを分けて描く。狭い画面では初期表示を
              画面幅に収まるよう縮小する(BracketScroller)。拡大はピンチズームで行う。

              **表が無くてもマウントする。** このページは表を見に来る場所なので、
              開いたまま主催者が表を作ったら出るようにしておく(破棄→再作成も拾う)。 */}
          <div className="mt-6">
            <BracketLive
              slug={event.slug}
              initial={bracket}
              initialStatus={event.status}
              initialFinalizedAt={event.finalizedAt?.toISOString() ?? null}
              empty={
                <p className={`border border-dashed border-border p-4 text-sm text-muted ${CARD_CLIP}`}>
                  まだ対戦表が公開されていない。
                </p>
              }
            />
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted">
            集計は当サービスが受信したギフトに基づく。通信状況により実際と差が出る場合がある。
            対戦が自動で検知できなかった場合は主催者が結果を確定する。
          </p>
        </>
      )}
    </div>
  );
}
