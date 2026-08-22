import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatJst, formatJstRange } from "@/event/datetime";
import { ENTRY_MODE_LABELS, FORMAT_LABELS, STATUS_CLASSES, STATUS_LABELS } from "@/event/labels";
import { findPublicEvent, loadEventSnapshot } from "@/event/public-event";
import { resolveEventWindows } from "@/event/sessions";
import type { EntryMode, EventFormat, EventStatus } from "@/event/validation";
import { EventResults } from "./EventResults";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const session = await getServerSession(authOptions);
  const event = await findPublicEvent(params.slug, session?.user?.id);
  if (!event) return { title: "イベントが見つからない" };

  const description =
    event.description?.slice(0, 120) ??
    `${FORMAT_LABELS[event.format as EventFormat]} / ${formatJst(event.startAt)} 〜 ${formatJst(event.endAt)}`;

  return {
    title: `${event.title} | LIVE Sidestage Event`,
    description,
    openGraph: {
      title: event.title,
      description,
      type: "website",
    },
    // 非公開(オーナーのプレビュー)は検索避けする。
    robots: event.visibility === "PUBLIC" ? undefined : { index: false, follow: false },
  };
}

export default async function PublicEventPage({ params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions);
  const event = await findPublicEvent(params.slug, session?.user?.id);
  if (!event) notFound();

  const [snapshot, matchCount] = await Promise.all([
    loadEventSnapshot(event),
    event.format === "TOURNAMENT"
      ? prisma.eventMatch.count({ where: { eventId: event.id } })
      : Promise.resolve(0),
  ]);
  const hasBracket = matchCount > 0;
  const windows = resolveEventWindows(event);

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASSES[event.status as EventStatus]}`}>
            {STATUS_LABELS[event.status as EventStatus]}
          </span>
          <span className="text-xs text-gray-500">
            {FORMAT_LABELS[event.format as EventFormat]} ・{" "}
            {ENTRY_MODE_LABELS[event.entryMode as EntryMode]}
          </span>
        </div>

        <h1 className="mt-3 text-2xl font-bold">{event.title}</h1>

        {/* 日程が複数あるイベントは1行にまとめない。外枠だけ出すと、
            集計されない隙間(1日目の終了〜2日目の開始)まで開催中に見えてしまう。 */}
        {windows.length === 1 ? (
          <p className="mt-2 font-mono text-sm text-gray-400">
            {formatJst(event.startAt)} 〜 {formatJst(event.endAt)}
          </p>
        ) : (
          <ul className="mt-2 grid gap-1">
            {windows.map((w, index) => (
              <li key={index} className="flex flex-wrap items-baseline gap-x-2 text-sm text-gray-400">
                <span className="text-xs text-gray-500">{w.name || `${index + 1}日目`}</span>
                <span className="font-mono">{formatJstRange(w.start, w.end)}</span>
              </li>
            ))}
          </ul>
        )}

        {event.description && (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
            {event.description}
          </p>
        )}

        <p className="mt-4 text-xs text-gray-500">
          {event._count.participants > 0
            ? `${event._count.participants} 人が参加`
            : "参加者はまだ登録されていない。"}
        </p>

        {event.format === "TOURNAMENT" && hasBracket && (
          <Link
            href={`/e/${event.slug}/bracket`}
            className="card mt-4 flex items-center justify-between hover:border-brand/40"
          >
            <span className="text-sm font-medium">トーナメント表</span>
            <span className="text-xs text-gray-500">対戦と勝敗を見る →</span>
          </Link>
        )}

        <EventResults
          slug={event.slug}
          status={event.status}
          entryMode={event.entryMode}
          format={event.format}
          initial={{ ...snapshot, participantContributions: null }}
        />

        <p className="mt-8 text-xs leading-relaxed text-gray-600">
          集計は当サービスが受信したギフトに基づく。通信状況により実際の数値と差が出る場合がある。
        </p>
      </div>
    </main>
  );
}
