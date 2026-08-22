import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { defaultSeedOrder } from "@/event/tournament";
import { parseDeathmatchRules } from "@/event/deathmatch";
import { resolveEventWindows } from "@/event/sessions";
import { MatchManager, type EntrantOption, type LifeRow, type MatchRow } from "./MatchManager";

export const dynamic = "force-dynamic";

export default async function MatchesPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const event = await prisma.event.findFirst({
    where: { id: params.id, ownerUserId: session!.user.id },
    select: {
      id: true,
      title: true,
      format: true,
      entryMode: true,
      status: true,
      rules: true,
      startAt: true,
      endAt: true,
      sessions: {
        orderBy: { startAt: "asc" },
        select: { startAt: true, endAt: true, name: true },
      },
    },
  });

  if (!event) notFound();

  const [matches, participants, teams, seedOrder, lifePoints] = await Promise.all([
    prisma.eventMatch.findMany({
      where: { eventId: event.id },
      orderBy: [{ round: "asc" }, { bracketPosition: "asc" }],
      select: {
        id: true,
        round: true,
        bracketPosition: true,
        status: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        detectedStartAt: true,
        detectedEndAt: true,
        detectionConfidence: true,
        detectedEndSource: true,
        winnerSideId: true,
        winnerDecidedBy: true,
        rules: true,
        sides: {
          orderBy: { sideIndex: "asc" },
          select: {
            id: true,
            sideIndex: true,
            diamonds: true,
            team: { select: { name: true } },
            participants: {
              select: { participant: { select: { displayName: true, tiktokId: true } } },
            },
          },
        },
      },
    }),
    prisma.eventParticipant.findMany({
      where: { eventId: event.id, status: "ACTIVE" },
      select: { id: true, displayName: true, tiktokId: true },
    }),
    prisma.eventTeam.findMany({
      where: { eventId: event.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        // チーム戦でも「実際にバトルへ出る人」を選ばせるので、所属メンバーが要る。
        participants: {
          where: { status: "ACTIVE" },
          orderBy: { joinedAt: "asc" },
          select: { id: true, displayName: true, tiktokId: true },
        },
      },
    }),
    defaultSeedOrder(params.id, event.entryMode === "TEAM" ? "TEAM" : "SOLO"),
    event.format === "DEATHMATCH"
      ? prisma.eventLifePoint.findMany({
          where: { eventId: event.id },
          select: { subjectId: true, current: true, max: true, eliminatedAt: true },
        })
      : Promise.resolve([]),
  ]);

  const label = (p: { displayName: string; tiktokId: string }) =>
    `${p.displayName} (@${p.tiktokId})`;

  const optionsById = new Map<string, EntrantOption>(
    event.entryMode === "TEAM"
      ? teams.map((t) => [
          t.id,
          {
            id: t.id,
            label: t.name,
            members: t.participants.map((p) => ({ id: p.id, label: label(p) })),
          },
        ])
      : participants.map((p) => [
          p.id,
          { id: p.id, label: label(p), members: [{ id: p.id, label: label(p) }] },
        ])
  );
  // 順位表の順に並べ、そこに載っていないものを後ろへ足す。
  const entrants: EntrantOption[] = [
    ...seedOrder.map((id) => optionsById.get(id)).filter((v): v is EntrantOption => !!v),
    ...[...optionsById.values()].filter((o) => !seedOrder.includes(o.id)),
  ];

  const lifeById = new Map(lifePoints.map((l) => [l.subjectId, l]));
  const lives: LifeRow[] = entrants.map((e) => {
    const life = lifeById.get(e.id);
    return {
      subjectId: e.id,
      label: e.label,
      current: life?.current ?? null,
      max: life?.max ?? null,
      eliminated: !!life?.eliminatedAt,
    };
  });

  const rows: MatchRow[] = matches.map((m) => ({
    id: m.id,
    round: m.round,
    position: m.bracketPosition,
    roundLabel:
      typeof (m.rules as { roundLabel?: unknown } | null)?.roundLabel === "string"
        ? ((m.rules as { roundLabel: string }).roundLabel)
        : `${m.round}回戦`,
    status: m.status,
    scheduledStartAt: m.scheduledStartAt.toISOString(),
    scheduledEndAt: m.scheduledEndAt.toISOString(),
    detectedStartAt: m.detectedStartAt?.toISOString() ?? null,
    detectedEndAt: m.detectedEndAt?.toISOString() ?? null,
    detectionConfidence: m.detectionConfidence,
    detectedEndSource: m.detectedEndSource,
    winnerSideId: m.winnerSideId,
    winnerDecidedBy: m.winnerDecidedBy,
    sides: m.sides.map((s) => ({
      id: s.id,
      sideIndex: s.sideIndex,
      // BigInt はクライアントへ渡せないので文字列にする。
      diamonds: s.diamonds.toString(),
      label:
        s.team?.name ??
        s.participants.map((p) => p.participant.displayName).join(" / ") ??
        "",
      empty: s.participants.length === 0 && !s.team,
    })),
  }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href={`/events/${event.id}`} className="text-sm text-gray-400 hover:text-white">
        ← {event.title}
      </Link>
      <h1 className="mt-2 text-2xl font-bold">対戦管理</h1>
      <p className="mt-1 text-sm text-gray-400">
        主催者が組んだ時間枠と組み合わせに対して、実際の TikTok バトルを自動で照合する。
      </p>

      <div className="mt-6">
        <MatchManager
          eventId={event.id}
          format={event.format}
          entryMode={event.entryMode}
          sessions={resolveEventWindows(event).map((w) => ({
            name: w.name,
            startAt: w.start.toISOString(),
            endAt: w.end.toISOString(),
          }))}
          entrants={entrants}
          matches={rows}
          lives={lives}
          rules={parseDeathmatchRules(event.rules)}
        />
      </div>
    </div>
  );
}
