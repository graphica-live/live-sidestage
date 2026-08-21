import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ENTRY_MODE_LABELS, FORMAT_LABELS, STATUS_CLASSES, STATUS_LABELS, formatJst } from "@/event/labels";
import type { EntryMode, EventFormat, EventStatus } from "@/event/validation";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const session = await getServerSession(authOptions);
  const events = await prisma.event.findMany({
    where: { ownerUserId: session!.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      slug: true,
      title: true,
      format: true,
      entryMode: true,
      status: true,
      startAt: true,
      endAt: true,
      _count: { select: { participants: true } },
    },
  });

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
          <p className="text-sm text-gray-400">まだイベントがない。</p>
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
                    <h2 className="truncate text-sm font-semibold text-white">{event.title}</h2>
                    <p className="mt-1 text-xs text-gray-400">
                      {FORMAT_LABELS[event.format as EventFormat]} ・{" "}
                      {ENTRY_MODE_LABELS[event.entryMode as EntryMode]} ・ 参加 {event._count.participants} 人
                    </p>
                    <p className="mt-1 font-mono text-xs text-gray-500">
                      {formatJst(event.startAt)} 〜 {formatJst(event.endAt)}
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
    </div>
  );
}
