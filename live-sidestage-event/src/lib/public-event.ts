import { prisma } from "./prisma";

// 公開ページ(認証なし)が読むデータをここにまとめる。
// BigInt と Decimal はそのままだと JSON にできず、クライアントコンポーネントへも渡せないので、
// この層で文字列へ変換してから外に出す。

/**
 * 公開してよいイベントか。
 * PRIVATE は誰にも見せない。DRAFT は URL を知っていても見せない(準備中のため)。
 */
export async function findPublicEvent(slug: string) {
  const event = await prisma.event.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      format: true,
      entryMode: true,
      teamPreset: true,
      status: true,
      visibility: true,
      startAt: true,
      endAt: true,
      lastAggregatedAt: true,
      _count: { select: { participants: true } },
    },
  });

  if (!event) return null;
  if (event.visibility === "PRIVATE") return null;
  if (event.status === "DRAFT") return null;
  return event;
}

export type StandingDto = {
  subjectId: string;
  name: string;
  /** 参加者なら @tiktokId、チームなら所属人数の表示 */
  sub: string | null;
  colorHex: string | null;
  rank: number;
  diamonds: string;
  points: string;
};

export type ContributionDto = {
  listenerUniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  diamonds: string;
  points: string;
  giftCount: number;
};

export type EventSnapshot = {
  standings: StandingDto[];
  /** イベント全体のリスナー貢献(scope=EVENT) */
  eventContributions: ContributionDto[];
  participants: { id: string; displayName: string; tiktokId: string }[];
  lastAggregatedAt: string | null;
  /** 倍率が設定されているか。ないならポイント表示を出さずダイヤだけ見せる */
  hasMultiplier: boolean;
};

function toContributionDto(row: {
  listenerUniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  diamonds: bigint;
  points: unknown;
  giftCount: number;
}): ContributionDto {
  return {
    listenerUniqueId: row.listenerUniqueId,
    nickname: row.nickname,
    profileImageUrl: row.profileImageUrl,
    diamonds: row.diamonds.toString(),
    points: String(row.points),
    giftCount: row.giftCount,
  };
}

/**
 * 順位表と全体ランキングを1回で読む。公開ページの初期表示とポーリングの両方で使う。
 *
 * `EventStanding.subjectId` は participant / team のどちらかを指すが FK ではないので、
 * 名前は別に引いて突き合わせる。
 */
export async function loadEventSnapshot(event: {
  id: string;
  entryMode: string;
  lastAggregatedAt: Date | null;
}): Promise<EventSnapshot> {
  const subjectType = event.entryMode === "TEAM" ? "TEAM" : "PARTICIPANT";

  const [standings, contributions, participants, teams, multiplierCount] = await Promise.all([
    prisma.eventStanding.findMany({
      where: { eventId: event.id, subjectType },
      orderBy: { rank: "asc" },
    }),
    prisma.eventContribution.findMany({
      where: { eventId: event.id, scope: "EVENT", scopeId: "" },
      orderBy: [{ points: "desc" }, { diamonds: "desc" }],
    }),
    prisma.eventParticipant.findMany({
      where: { eventId: event.id },
      select: { id: true, displayName: true, tiktokId: true, teamId: true },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.eventTeam.findMany({
      where: { eventId: event.id },
      select: { id: true, name: true, colorHex: true },
    }),
    prisma.eventMultiplier.count({ where: { eventId: event.id } }),
  ]);

  const participantById = new Map(participants.map((p) => [p.id, p]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const teamSize = new Map<string, number>();
  for (const p of participants) {
    if (p.teamId) teamSize.set(p.teamId, (teamSize.get(p.teamId) ?? 0) + 1);
  }

  const standingDtos: StandingDto[] = standings.flatMap((s) => {
    if (subjectType === "TEAM") {
      const team = teamById.get(s.subjectId);
      if (!team) return [];
      return [
        {
          subjectId: s.subjectId,
          name: team.name,
          sub: `${teamSize.get(team.id) ?? 0} 人`,
          colorHex: team.colorHex,
          rank: s.rank,
          diamonds: s.diamonds.toString(),
          points: String(s.points),
        },
      ];
    }

    const participant = participantById.get(s.subjectId);
    if (!participant) return [];
    return [
      {
        subjectId: s.subjectId,
        name: participant.displayName,
        sub: `@${participant.tiktokId}`,
        colorHex: null,
        rank: s.rank,
        diamonds: s.diamonds.toString(),
        points: String(s.points),
      },
    ];
  });

  return {
    standings: standingDtos,
    eventContributions: contributions.map(toContributionDto),
    participants: participants.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      tiktokId: p.tiktokId,
    })),
    lastAggregatedAt: event.lastAggregatedAt?.toISOString() ?? null,
    hasMultiplier: multiplierCount > 0,
  };
}

/** 参加者1人ぶんのリスナー貢献ランキング。 */
export async function loadParticipantContributions(
  eventId: string,
  participantId: string
): Promise<ContributionDto[]> {
  const rows = await prisma.eventContribution.findMany({
    where: { eventId, scope: "PARTICIPANT", scopeId: participantId },
    orderBy: [{ points: "desc" }, { diamonds: "desc" }],
  });
  return rows.map(toContributionDto);
}

/** 3桁区切り。BigInt 由来の文字列をそのまま整形する(Number へ落とさない)。 */
export function formatNumber(value: string): string {
  const [int, frac] = value.split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const digits = sign ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${sign}${grouped}.${frac}` : `${sign}${grouped}`;
}

/** ポイントの小数部が .00 なら落とす(実数=ポイントのイベントで冗長なため)。 */
export function formatPoints(value: string): string {
  const trimmed = value.endsWith(".00") ? value.slice(0, -3) : value;
  return formatNumber(trimmed);
}
