import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ENTRY_MODE_LABELS,
  FORMAT_LABELS,
  STATUS_CLASSES,
  STATUS_LABELS,
  VISIBILITY_LABELS,
  formatJst,
} from "@/event/labels";
import type { EntryMode, EventFormat, EventStatus, Visibility } from "@/event/validation";

export const dynamic = "force-dynamic";

// トップに並べるのは直近開催分だけで十分なので、無制限に増え続けないよう上限を切る。
const PUBLIC_EVENTS_LIMIT = 30;

export default async function EventsPage() {
  const session = await getServerSession(authOptions);
  const [events, publicEvents] = await Promise.all([
    prisma.event.findMany({
      where: { ownerUserId: session!.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        slug: true,
        title: true,
        format: true,
        entryMode: true,
        status: true,
        visibility: true,
        startAt: true,
        endAt: true,
        _count: { select: { participants: true, sessions: true } },
      },
    }),
    prisma.event.findMany({
      where: { visibility: "PUBLIC" },
      orderBy: { startAt: "desc" },
      take: PUBLIC_EVENTS_LIMIT,
      select: {
        id: true,
        slug: true,
        title: true,
        format: true,
        entryMode: true,
        status: true,
        startAt: true,
        endAt: true,
        _count: { select: { participants: true, sessions: true } },
      },
    }),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold">イベント</h1>
        <Link href="/events/new" className="btn-primary text-sm">
          新しいイベント
        </Link>
      </div>

      {events.length === 0 ? (
        <div className="card text-center">
          <p className="text-sm text-muted">まだイベントがない。</p>
          <Link href="/events/new" className="mt-3 inline-block text-sm text-brand hover:underline">
            最初のイベントを作る
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3">
          {events.map((event) => (
            <li key={event.id}>
              <Link href={`/events/${event.id}`} className="card block transition-colors hover:border-brand/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-strong">{event.title}</h2>
                    <p className="mt-1 text-xs text-muted">
                      {FORMAT_LABELS[event.format as EventFormat]} ・{" "}
                      {ENTRY_MODE_LABELS[event.entryMode as EntryMode]} ・ 参加 {event._count.participants} 人
                    </p>
                    <p className="mt-1 font-mono text-xs text-muted">
                      {formatJst(event.startAt)} 〜 {formatJst(event.endAt)}
                      {/* 外枠だけでは日程の隙間が見えないので、複数日程は件数を添える。 */}
                      {event._count.sessions > 1 && (
                        <span className="ml-2 font-sans text-muted">
                          全 {event._count.sessions} 日程
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASSES[event.status as EventStatus]}`}
                    >
                      {STATUS_LABELS[event.status as EventStatus]}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        event.visibility === "PUBLIC"
                          ? "bg-green-400/10 text-green-600 dark:text-green-400"
                          : "bg-black/5 dark:bg-white/5 text-muted"
                      }`}
                    >
                      {VISIBILITY_LABELS[event.visibility as Visibility]}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-bold">公開中のイベント</h2>

        {publicEvents.length === 0 ? (
          <div className="card text-center">
            <p className="text-sm text-muted">現在公開されているイベントはない。</p>
          </div>
        ) : (
          <ul className="grid gap-3">
            {publicEvents.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/e/${event.slug}`}
                  className="card block transition-colors hover:border-brand/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-strong">{event.title}</h3>
                      <p className="mt-1 text-xs text-muted">
                        {FORMAT_LABELS[event.format as EventFormat]} ・{" "}
                        {ENTRY_MODE_LABELS[event.entryMode as EntryMode]} ・ 参加 {event._count.participants} 人
                      </p>
                      <p className="mt-1 font-mono text-xs text-muted">
                        {formatJst(event.startAt)} 〜 {formatJst(event.endAt)}
                        {event._count.sessions > 1 && (
                          <span className="ml-2 font-sans text-muted">
                            全 {event._count.sessions} 日程
                          </span>
                        )}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_CLASSES[event.status as EventStatus]}`}
                    >
                      {STATUS_LABELS[event.status as EventStatus]}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
