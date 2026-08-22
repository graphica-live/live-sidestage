import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findRoomStatuses, findStreamerLinks } from "@/event/analytics-db";
import { MAX_PARTICIPANTS, type EventFormat } from "@/event/validation";
import { EventSetupSteps } from "../../EventSetupSteps";
import { ParticipantManager, type ParticipantRow } from "./ParticipantManager";
import { TeamManager, type TeamRow } from "./TeamManager";

export const dynamic = "force-dynamic";

export default async function ParticipantsPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const event = await prisma.event.findFirst({
    where: { id: params.id, ownerUserId: session!.user.id },
    select: { id: true, title: true, format: true, entryMode: true, teamPreset: true, status: true },
  });

  if (!event) notFound();

  const [participants, teams] = await Promise.all([
    prisma.eventParticipant.findMany({
      where: { eventId: event.id },
      orderBy: { joinedAt: "asc" },
      select: {
        id: true,
        tiktokId: true,
        roomId: true,
        displayName: true,
        status: true,
        teamId: true,
        team: { select: { name: true } },
      },
    }),
    prisma.eventTeam.findMany({
      where: { eventId: event.id },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        colorHex: true,
        prefectureCode: true,
        _count: { select: { participants: true } },
      },
    }),
  ]);

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
    teamId: p.teamId,
    teamName: p.team?.name ?? null,
    registered: links.has(p.roomId),
    verified: links.get(p.roomId)?.verified ?? false,
    listenerStatus: statuses.get(p.roomId)?.listenerStatus ?? null,
  }));

  const teamRows: TeamRow[] = teams.map((t) => ({
    id: t.id,
    name: t.name,
    colorHex: t.colorHex,
    prefectureCode: t.prefectureCode,
    memberCount: t._count.participants,
  }));

  const isTeamEvent = event.entryMode === "TEAM";

  return (
    <div>
      <Link href={`/events/${event.id}`} className="text-xs text-gray-500 hover:text-white">
        ← {event.title}
      </Link>
      <h1 className="mb-1 mt-2 text-xl font-bold">参加者</h1>

      <EventSetupSteps format={event.format as EventFormat} current="participants" />

      <p className="mb-6 text-xs text-gray-500">
        {rows.length} / {MAX_PARTICIPANTS} 人
      </p>

      {isTeamEvent && (
        <div className="mb-8">
          <TeamManager eventId={event.id} teamPreset={event.teamPreset} teams={teamRows} />
        </div>
      )}

      <ParticipantManager
        eventId={event.id}
        status={event.status}
        participants={rows}
        teams={isTeamEvent ? teamRows.map((t) => ({ id: t.id, name: t.name })) : []}
      />

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Link
          href={
            event.format === "TOURNAMENT" ? `/events/${event.id}/matches` : `/events/${event.id}`
          }
          className="btn-primary text-sm"
        >
          {event.format === "TOURNAMENT" ? "次へ: トーナメント表を作る" : "次へ: 完了"}
        </Link>
        <span className="text-xs text-gray-500">
          {rows.length === 0 && "参加者は0人でも先へ進める。"}
          参加者はあとからでも追加・変更・削除できる。
        </span>
      </div>
    </div>
  );
}
