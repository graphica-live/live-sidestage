import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { findPublicEvent, loadBracket } from "@/event/public-event";
import { BracketTree } from "./BracketTree";

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
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href={`/e/${event.slug}`} className="text-sm text-gray-400 hover:text-white">
        ← {event.title}
      </Link>
      <h1 className="mt-2 text-2xl font-bold">トーナメント表</h1>

      {!bracket ? (
        <p className="card mt-6 text-sm text-gray-500">
          {event.format === "TOURNAMENT"
            ? "まだ対戦表が公開されていない。"
            : "この種目にトーナメント表はない。"}
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-400">
            勝敗は当サービスが受信したギフトのダイヤで決まる。バトル中に投げられたぶんが対象。
          </p>

          {/* 決勝を中央に置き、左右へブロックを分けて描く。狭い画面では横スクロールになるが、
              初期位置は決勝(中央)に合わせてある(BracketScroller)。 */}
          <div className="mt-6">
            <BracketTree roundCount={bracket.roundCount} matches={bracket.matches} />
          </div>

          <p className="mt-2 text-xs leading-relaxed text-gray-600">
            集計は当サービスが受信したギフトに基づく。通信状況により実際と差が出る場合がある。
            対戦が自動で検知できなかった場合は主催者が結果を確定する。
          </p>
        </>
      )}
    </div>
  );
}
