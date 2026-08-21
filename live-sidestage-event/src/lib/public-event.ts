import { prisma } from "./prisma";
import { rankByLife } from "./deathmatch";

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

export type BracketSideDto = {
  id: string;
  sideIndex: number;
  name: string | null;
  diamonds: string;
  isWinner: boolean;
};

export type BracketMatchDto = {
  id: string;
  round: number;
  position: number;
  roundLabel: string;
  status: string;
  scheduledStartAt: string;
  detectedStartAt: string | null;
  winnerDecidedBy: string | null;
  sides: BracketSideDto[];
};

export type BracketDto = {
  roundCount: number;
  matches: BracketMatchDto[];
};

/**
 * トーナメント表。勝敗がまだ出ていない対戦も枠として出す。
 *
 * 承認待ち(NEEDS_REVIEW)は公開側では「進行中」と同じ扱いにする。主催者の確認待ちであることは
 * 閲覧者に関係がなく、確定していない結果を出さないという点では同じため。
 */
export async function loadBracket(eventId: string): Promise<BracketDto | null> {
  const matches = await prisma.eventMatch.findMany({
    where: { eventId },
    orderBy: [{ round: "asc" }, { bracketPosition: "asc" }],
    select: {
      id: true,
      round: true,
      bracketPosition: true,
      status: true,
      scheduledStartAt: true,
      detectedStartAt: true,
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
          participants: { select: { participant: { select: { displayName: true } } } },
        },
      },
    },
  });

  if (matches.length === 0) return null;

  return {
    roundCount: Math.max(...matches.map((m) => m.round)),
    matches: matches.map((m) => ({
      id: m.id,
      round: m.round,
      position: m.bracketPosition,
      roundLabel:
        typeof (m.rules as { roundLabel?: unknown } | null)?.roundLabel === "string"
          ? (m.rules as { roundLabel: string }).roundLabel
          : `${m.round}回戦`,
      status: m.status === "NEEDS_REVIEW" ? "LIVE" : m.status,
      scheduledStartAt: m.scheduledStartAt.toISOString(),
      detectedStartAt: m.detectedStartAt?.toISOString() ?? null,
      winnerDecidedBy: m.winnerDecidedBy,
      sides: m.sides.map((s) => {
        const name =
          s.team?.name ??
          (s.participants.length > 0
            ? s.participants.map((p) => p.participant.displayName).join(" / ")
            : null);
        return {
          id: s.id,
          sideIndex: s.sideIndex,
          name,
          diamonds: s.diamonds.toString(),
          // 確定するまでは勝者を出さない(NEEDS_REVIEW のまま公開しない)。
          isWinner: m.status === "FINISHED" && m.winnerSideId === s.id,
        };
      }),
    })),
  };
}

/** デスマッチの残ライフ。ライフ順に並んでいる(獲得ダイヤの順位とは別物)。 */
export type LifeStandingDto = StandingDto & {
  current: number;
  max: number;
  eliminated: boolean;
};

export type EventSnapshot = {
  standings: StandingDto[];
  /** デスマッチのときだけ入る。ライフ順(残ライフ → 脱落の遅さ → 獲得ダイヤ) */
  lives: LifeStandingDto[] | null;
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
  format: string;
  entryMode: string;
  lastAggregatedAt: Date | null;
}): Promise<EventSnapshot> {
  const subjectType = event.entryMode === "TEAM" ? "TEAM" : "PARTICIPANT";

  const [standings, contributions, participants, teams, multiplierCount, lifePoints] =
    await Promise.all([
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
      event.format === "DEATHMATCH"
        ? prisma.eventLifePoint.findMany({
            where: { eventId: event.id, subjectType },
            select: { subjectId: true, current: true, max: true, eliminatedAt: true },
          })
        : Promise.resolve([]),
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

  // デスマッチの順位はライフで決まる。獲得ダイヤの順位(standings)とは別に持つ。
  let lives: LifeStandingDto[] | null = null;
  if (event.format === "DEATHMATCH" && lifePoints.length > 0) {
    const lifeById = new Map(lifePoints.map((l) => [l.subjectId, l]));
    const withLife = standingDtos.flatMap((s) => {
      const life = lifeById.get(s.subjectId);
      if (!life) return [];
      return [
        {
          ...s,
          current: life.current,
          max: life.max,
          eliminated: !!life.eliminatedAt,
          eliminatedAt: life.eliminatedAt,
        },
      ];
    });

    lives = rankByLife(withLife).map(({ eliminatedAt: _drop, ...row }) => row);
  }

  return {
    standings: standingDtos,
    lives,
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
