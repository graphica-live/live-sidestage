import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toJstInputValue } from "@/event/datetime";
import { resolveEventWindows } from "@/event/sessions";
import { EventForm, type EventFormValues } from "../EventForm";
import { EventAdminControls } from "./EventAdminControls";
import type { EntryMode, EventFormat, TeamPreset, Visibility } from "@/event/validation";

export const dynamic = "force-dynamic";

export default async function EventDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const event = await prisma.event.findFirst({
    where: { id: params.id, ownerUserId: session!.user.id },
    include: {
      sessions: { orderBy: { startAt: "asc" } },
      _count: { select: { participants: true, matches: true } },
    },
  });

  if (!event) notFound();

  const initial: EventFormValues = {
    title: event.title,
    description: event.description ?? "",
    format: event.format as EventFormat,
    entryMode: event.entryMode as EntryMode,
    teamPreset: event.teamPreset as TeamPreset,
    visibility: event.visibility as Visibility,
    // 日程を持たないイベント(この機能より前に作られたもの)は外枠を1日程として出す。
    sessions: resolveEventWindows(event).map((w) => ({
      name: w.name ?? "",
      startAt: toJstInputValue(w.start),
      endAt: toJstInputValue(w.end),
    })),
  };

  return (
    <div>
      <Link href="/events" className="text-xs text-gray-500 hover:text-white">
        ← イベント一覧
      </Link>
      <h1 className="mb-6 mt-2 truncate text-xl font-bold">{event.title}</h1>

      <EventAdminControls id={event.id} slug={event.slug} status={event.status} />

      <Link
        href={`/events/${event.id}/participants`}
        className="card mt-4 flex items-center justify-between hover:border-brand/40"
      >
        <span className="text-sm font-medium">参加者</span>
        <span className="text-xs text-gray-500">
          {event._count.participants} 人 →
        </span>
      </Link>

      {event.format === "TOURNAMENT" && (
        <Link
          href={`/events/${event.id}/matches`}
          className="card mt-2 flex items-center justify-between hover:border-brand/40"
        >
          <span className="text-sm font-medium">対戦</span>
          <span className="text-xs text-gray-500">
            {event._count.matches > 0 ? `${event._count.matches} 試合 →` : "表を作る →"}
          </span>
        </Link>
      )}

      <h2 className="mb-4 mt-8 text-sm font-semibold text-gray-300">設定</h2>
      <EventForm mode="edit" eventId={event.id} initial={initial} />
    </div>
  );
}
