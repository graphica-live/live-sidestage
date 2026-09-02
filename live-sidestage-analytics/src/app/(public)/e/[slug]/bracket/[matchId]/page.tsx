import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findPublicEvent } from "@/event/public-event";
import { matchDetailCache } from "@/event/match-detail";
import { MatchDetailBody } from "../match-detail-ui";

// トーナメント表からは対戦カードのタップでモーダル(MatchDetailModal.tsx)を開くので、
// このページへは通常遷移しない。直接URLを踏まれた場合(共有・ブックマーク・ロボット)の
// フォールバックとして残してある。

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { slug: string; matchId: string };
}): Promise<Metadata> {
  const session = await getServerSession(authOptions);
  const event = await findPublicEvent(params.slug, session?.user?.id);
  if (!event || event.format !== "TOURNAMENT") return { title: "見つかりません" };
  return {
    title: `対戦詳細 — ${event.title}`,
    robots: event.visibility === "PUBLIC" ? undefined : { index: false, follow: false },
  };
}

export default async function MatchDetailPage({
  params,
}: {
  params: { slug: string; matchId: string };
}) {
  const session = await getServerSession(authOptions);
  const event = await findPublicEvent(params.slug, session?.user?.id);
  if (!event || event.format !== "TOURNAMENT") notFound();

  const detail = await matchDetailCache.load(prisma, {
    event,
    matchId: params.matchId,
    now: new Date(),
  });
  if (!detail) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href={`/e/${event.slug}/bracket`}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand"
      >
        ← トーナメント表
      </Link>

      <div className="mt-3">
        <MatchDetailBody detail={detail} />
      </div>
    </div>
  );
}
