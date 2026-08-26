import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBracketMethod, parsePlacementDepth } from "@/event/bracket-rules";
import { defaultSeedOrder } from "@/event/tournament";
import { canShowTiktokScore, loadMatchTiktokScores } from "@/event/battle-score";
import { parseDeathmatchRules } from "@/event/deathmatch";
import { isByeRow, isForceFullPeriod, parsePlacement } from "@/event/match-status";
import { formatNumber } from "@/event/public-event";
import { EventSetupSteps } from "../../EventSetupSteps";
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
        // **id まで渡す。** 対戦の割り当て先を選ばせるので、表示だけでは足りない。
        select: { id: true, startAt: true, endAt: true, name: true },
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
        sessionId: true,
        detectedStartAt: true,
        detectedEndAt: true,
        detectionConfidence: true,
        detectedEndSource: true,
        detectedBattleId: true,
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
              select: {
                // 組み合わせ変更の楽観的排他に要る(クライアントが見ていた枠の中身)。
                participantId: true,
                participant: { select: { displayName: true, tiktokId: true, roomId: true } },
              },
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

  // TikTok 側のバトルスコア。管理側は partial 検知でも出す(detectionConfidence のバッジが
  // カードに出ているので、主催者は生の信号として読める)。
  // 整形はここで済ませてクライアントへは文字列で渡す(client から prisma を持つモジュールへ
  // 依存させない)。
  const tiktokScores = await loadMatchTiktokScores(
    prisma,
    matches
      .filter((m) => canShowTiktokScore(m, "admin"))
      .map((m) => ({
        detectedBattleId: m.detectedBattleId,
        sides: m.sides.map((s) => ({
          sideId: s.id,
          roomIds: s.participants.map((p) => p.participant.roomId),
        })),
      }))
  );

  const rows: MatchRow[] = matches.map((m) => ({
    id: m.id,
    round: m.round,
    position: m.bracketPosition,
    roundLabel:
      typeof (m.rules as { roundLabel?: unknown } | null)?.roundLabel === "string"
        ? ((m.rules as { roundLabel: string }).roundLabel)
        : `${m.round}回戦`,
    status: m.status,
    sessionId: m.sessionId,
    // 承認待ちの理由(候補が複数・終了未確定など)。カードに出して操作を選ばせる。
    reviewReason:
      typeof (m.rules as { reviewReason?: unknown } | null)?.reviewReason === "string"
        ? ((m.rules as { reviewReason: string }).reviewReason)
        : null,
    detectedStartAt: m.detectedStartAt?.toISOString() ?? null,
    detectedEndAt: m.detectedEndAt?.toISOString() ?? null,
    detectionConfidence: m.detectionConfidence,
    detectedEndSource: m.detectedEndSource,
    winnerSideId: m.winnerSideId,
    winnerDecidedBy: m.winnerDecidedBy,
    // rules を丸ごとクライアントへ流さず、要る値だけ渡す。
    isBye: isByeRow(m.rules),
    placement: parsePlacement(m.rules),
    // バトルスコアが出るはずの対戦か。**上の `filter` と同じ条件にする** — 条件がずれると、
    // そもそも問い合わせていない対戦にまで「未取得」と出る。
    battleScoreExpected: m.detectedBattleId !== null && canShowTiktokScore(m, "admin"),
    // ⚠️トラブル対処フラグ(集計を開催日程まるごとに強制するか)。isBye と同じ扱い。
    forceFullPeriod: isForceFullPeriod(m.rules),
    sides: m.sides.map((s) => ({
      id: s.id,
      sideIndex: s.sideIndex,
      // BigInt はクライアントへ渡せないので文字列にする。
      diamonds: s.diamonds.toString(),
      // TikTok 側のバトルスコア。帰属できなければ null(表示しない)。整形済みの文字列。
      tiktokScore: (() => {
        const raw = tiktokScores.get(s.id);
        return raw === undefined ? null : formatNumber(raw);
      })(),
      label:
        s.team?.name ??
        s.participants.map((p) => p.participant.displayName).join(" / ") ??
        "",
      empty: s.participants.length === 0 && !s.team,
      participantIds: s.participants.map((p) => p.participantId),
    })),
  }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href={`/events/${event.id}`} className="text-sm text-gray-400 hover:text-white">
        ← {event.title}
      </Link>
      <h1 className="mt-2 text-2xl font-bold">対戦管理</h1>
      <p className="mt-1 text-sm text-gray-400">
        対戦は開催日程に割り当てる。その日程の中で<strong>終了した</strong> TikTok バトルを
        組み合わせで自動照合する。
      </p>

      {event.format === "TOURNAMENT" && (
        <div className="mt-4">
          <EventSetupSteps format="TOURNAMENT" current="bracket" />
        </div>
      )}

      <div className="mt-6">
        <MatchManager
          eventId={event.id}
          eventTitle={event.title}
          eventStatus={event.status}
          format={event.format}
          entryMode={event.entryMode}
          sessions={event.sessions.map((s) => ({
            id: s.id,
            name: s.name,
            startAt: s.startAt.toISOString(),
            endAt: s.endAt.toISOString(),
          }))}
          entrants={entrants}
          matches={rows}
          lives={lives}
          rules={parseDeathmatchRules(event.rules)}
          bracketMethod={parseBracketMethod(event.rules)}
          eventPlacementDepth={parsePlacementDepth(event.rules)}
        />
      </div>

      {event.format === "TOURNAMENT" && (
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Link href={`/events/${event.id}`} className="btn-primary text-sm">
            次へ: 完了
          </Link>
          <span className="text-xs text-gray-500">
            組み合わせはあとからでも入れ替えられる。作り直すときは破棄してから。
          </span>
        </div>
      )}
    </div>
  );
}
