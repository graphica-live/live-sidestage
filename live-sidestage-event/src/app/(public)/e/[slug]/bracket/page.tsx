import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { findPublicEvent, loadBracket } from "@/lib/public-event";
import { formatJst } from "@/lib/datetime";
import { MATCH_STATUS_LABELS, WINNER_DECIDED_BY_LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const event = await findPublicEvent(params.slug);
  if (!event) return { title: "見つかりません" };
  return {
    title: `${event.title} — トーナメント表`,
    robots: event.visibility === "PUBLIC" ? undefined : { index: false, follow: false },
  };
}

export default async function BracketPage({ params }: { params: { slug: string } }) {
  const event = await findPublicEvent(params.slug);
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

          {/* 横スクロールで全ラウンドを見せる。ラウンドが増えても縦に潰れないようにする。
              後のラウンドほど試合数が半分になるので、justify-around で前ラウンドの
              2試合のちょうど中間に来るように置く(トーナメント表の見え方に合わせる)。 */}
          <div className="mt-6 overflow-x-auto pb-4">
            <div className="flex min-w-max items-stretch gap-4">
              {Array.from({ length: bracket.roundCount }, (_, i) => i + 1).map((round) => {
                const matches = bracket.matches.filter((m) => m.round === round);
                return (
                  <section key={round} className="flex w-56 shrink-0 flex-col sm:w-64">
                    <h2 className="mb-3 text-sm font-semibold text-gray-300">
                      {matches[0]?.roundLabel ?? `${round}回戦`}
                    </h2>
                    <div className="flex flex-1 flex-col justify-around gap-3">
                    {matches.map((match) => (
                      <article key={match.id} className="card space-y-2 p-3">
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>{formatJst(new Date(match.scheduledStartAt))}</span>
                          <span>{MATCH_STATUS_LABELS[match.status] ?? match.status}</span>
                        </div>
                        {match.sides.map((side) => (
                          <div
                            key={side.id}
                            className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm ${
                              side.isWinner ? "bg-brand/10 ring-1 ring-brand/40" : "bg-white/5"
                            }`}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {side.name ?? <span className="text-gray-600">未確定</span>}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-gray-400">
                              {Number(side.diamonds).toLocaleString("ja-JP")}
                            </span>
                          </div>
                        ))}
                        {match.winnerDecidedBy && match.winnerDecidedBy !== "AGGREGATE" && (
                          <p className="text-xs text-gray-500">
                            {WINNER_DECIDED_BY_LABELS[match.winnerDecidedBy]}
                          </p>
                        )}
                      </article>
                    ))}
                    </div>
                  </section>
                );
              })}
            </div>
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
