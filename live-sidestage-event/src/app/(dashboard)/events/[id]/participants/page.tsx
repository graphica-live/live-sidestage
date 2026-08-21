import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findRoomStatuses, findStreamerLinks } from "@/lib/analytics-db";
import { MAX_PARTICIPANTS } from "@/lib/validation";
import { ParticipantManager, type ParticipantRow } from "./ParticipantManager";

export const dynamic = "force-dynamic";

export default async function ParticipantsPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const event = await prisma.event.findFirst({
    where: { id: params.id, ownerUserId: session!.user.id },
    select: { id: true, title: true, entryMode: true },
  });

  if (!event) notFound();

  const participants = await prisma.eventParticipant.findMany({
    where: { eventId: event.id },
    orderBy: { joinedAt: "asc" },
    select: {
      id: true,
      tiktokId: true,
      roomId: true,
      displayName: true,
      status: true,
      team: { select: { name: true } },
    },
  });

  // analytics 側の情報(会員登録の有無・接続状態)は view 経由でまとめて引く。
  const roomIds = participants.map((p) => p.roomId);
  const [links, statuses] = await Promise.all([
    findStreamerLinks(roomIds),
    findRoomStatuses(roomIds),
  ]);

  const rows: ParticipantRow[] = participants.map((p) => ({
    id: p.id,
    tiktokId: p.tiktokId,
    displayName: p.displayName,
    status: p.status,
    teamName: p.team?.name ?? null,
    registered: links.has(p.roomId),
    verified: links.get(p.roomId)?.verified ?? false,
    listenerStatus: statuses.get(p.roomId)?.listenerStatus ?? null,
  }));

  return (
    <div>
      <Link href={`/events/${event.id}`} className="text-xs text-gray-500 hover:text-white">
        ← {event.title}
      </Link>
      <h1 className="mb-1 mt-2 text-xl font-bold">参加者</h1>
      <p className="mb-6 text-xs text-gray-500">
        {rows.length} / {MAX_PARTICIPANTS} 人
      </p>

      <ParticipantManager eventId={event.id} participants={rows} />
    </div>
  );
}
