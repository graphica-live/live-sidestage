import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatJst } from "@/lib/datetime";
import { ENTRY_MODE_LABELS, FORMAT_LABELS, STATUS_CLASSES, STATUS_LABELS } from "@/lib/labels";
import { findPublicEvent, loadEventSnapshot } from "@/lib/public-event";
import type { EntryMode, EventFormat, EventStatus } from "@/lib/validation";
import { EventResults } from "./EventResults";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const event = await findPublicEvent(params.slug);
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
    // UNLISTED は URL を知っている人だけのものなので検索避けする。
    robots: event.visibility === "PUBLIC" ? undefined : { index: false, follow: false },
  };
}

export default async function PublicEventPage({ params }: { params: { slug: string } }) {
  const event = await findPublicEvent(params.slug);
  if (!event) notFound();

  const snapshot = await loadEventSnapshot(event);

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

        <p className="mt-2 font-mono text-sm text-gray-400">
          {formatJst(event.startAt)} 〜 {formatJst(event.endAt)}
        </p>

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
