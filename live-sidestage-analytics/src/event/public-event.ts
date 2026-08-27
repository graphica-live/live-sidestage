import { prisma } from "@/lib/prisma";
import { findLiveRoomIds } from "./analytics-db";
import { canShowTiktokScore, loadMatchTiktokScores } from "./battle-score";
import { parseBreakdown, type ContributionBreakdownDto } from "./contribution-breakdown";
import { rankByLife } from "./deathmatch";
import { parsePlacement, parseWinnerFeeders } from "./match-status";
import { feederFlowEdges } from "./winner-feeders";

// 公開ページ(認証なし)が読むデータをここにまとめる。
// BigInt と Decimal はそのままだと JSON にできず、クライアントコンポーネントへも渡せないので、
// この層で文字列へ変換してから外に出す。

/**
 * 公開してよいイベントか。
 *
 * PRIVATE はオーナー以外の誰にも見せない(下書き概念はここに統合されている)。
 * `viewerUserId` はログイン中のユーザーID(未ログインなら undefined)。呼び出し側は
 * `getServerSession(authOptions)` で取った `session?.user?.id` をそのまま渡すこと。
 */
export async function findPublicEvent(slug: string, viewerUserId?: string) {
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
      ownerUserId: true,
      startAt: true,
      endAt: true,
      lastAggregatedAt: true,
      // 公開ページの見出し・注記は種目ではなくこの列で決める(過去のスナップショットへ
      // 新しい集計方式の説明を付けないため)。EventSnapshot.battleOnly を参照。
      aggregationPolicy: true,
      // 公開ページのポーリングを止める条件。**集計側の打ち切り(`aggregationWindow`)と
      // 揃えるため**に status ではなくこれを見る(主催者はいつでも FINISHED にできる)。
      finalizedAt: true,
      rules: true,
      coverImageKey: true,
      prizeText: true,
      noticeText: true,
      sessions: {
        orderBy: { startAt: "asc" },
        select: { id: true, name: true, startAt: true, endAt: true },
      },
      _count: { select: { participants: true, teams: true } },
    },
  });

  if (!event) return null;
  if (event.visibility === "PRIVATE" && event.ownerUserId !== viewerUserId) return null;
  return event;
}

/**
 * 公開してよいイベントに属する参加者の TikTok ハンドル。
 *
 * アイコン配信(`/api/public/avatar/[participantId]`)が、参加者IDを推測して
 * PRIVATE イベント(オーナー以外)の出場者を引き当てられないようにするための絞り込み。
 * 公開条件は `findPublicEvent()` と同じにしてある。
 *
 * `visibility` も返すのは、呼び出し側がオーナー限定の応答をキャッシュしないようにするため
 * (PUBLIC のときだけ共有キャッシュを許してよい)。
 */
export async function findPublicParticipantTiktokId(
  participantId: string,
  viewerUserId?: string
): Promise<{ tiktokId: string; visibility: string } | null> {
  const row = await prisma.eventParticipant.findFirst({
    where: { id: participantId },
    select: { tiktokId: true, event: { select: { visibility: true, ownerUserId: true } } },
  });
  if (!row) return null;
  if (row.event.visibility === "PRIVATE" && row.event.ownerUserId !== viewerUserId) return null;
  return { tiktokId: row.tiktokId, visibility: row.event.visibility };
}

export type { ContributionBreakdownDto };

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
  /**
   * 最も多くポイントを入れた参加者。イベント全体(scope=EVENT)でだけ入る。
   * 参加者が抜けた直後などで名前を解決できなければ null。
   */
  topParticipantName: string | null;
  /** ギフトを入れた参加者の人数。イベント全体でだけ意味を持つ */
  participantCount: number;
  /**
   * 参加者ごとの内訳。ポイント降順。イベント全体(scope=EVENT)でだけ入る。
   *
   * **null は「内訳を持たない行」** — 内訳に未対応だった頃の集計が書いた行
   * (finalizedAt が立った過去イベントは再集計されないので永久に null)、または
   * PARTICIPANT / TEAM scope。読み側は null のとき従来表示へフォールバックする。
   *
   * 参加者名は載せない。表示側が参加者一覧(`EventSnapshot.participants`)から引き、
   * 引けない参加者は落とす(`topParticipantName` と同じ規約)。
   */
  breakdown: ContributionBreakdownDto[] | null;
};

/**
 * サイドに出る1人。アイコンは `/api/public/avatar/<participantId>` から引く
 * (URL をここに埋めない — TikTok の avatar URL は署名付きで約2日で失効する)。
 *
 * avatarOffsetX/Y/Zoom は表示専用の切り出し設定。null は現状のデフォルト表示
 * (50%/30%/等倍)で、解決は `src/event/avatar-frame.ts` に閉じる。
 */
export type BracketEntrantDto = {
  participantId: string;
  displayName: string;
  avatarOffsetX: number | null;
  avatarOffsetY: number | null;
  avatarZoom: number | null;
};

export type BracketSideDto = {
  id: string;
  sideIndex: number;
  name: string | null;
  /** 個人戦なら1人、チーム戦は出場メンバー全員。未確定のサイドは空。 */
  entrants: BracketEntrantDto[];
  diamonds: string;
  /**
   * TikTok 側が配信したバトルスコア(`hostScore`)の合計。**当サービスの集計とは別物**で、
   * 勝敗はこちらではなく `diamonds` で決まる。帰属できなかったサイドは null(表示しない)。
   */
  tiktokScore: string | null;
  isWinner: boolean;
  /**
   * バトル前(対戦の status が SCHEDULED)の対戦でだけ意味を持つ。出場者の誰かが
   * 今まさに TikTok Live に接続できているか。それ以外の状態では常に false。
   */
  hasLiveStreamer: boolean;
};

export type BracketMatchDto = {
  id: string;
  round: number;
  position: number;
  roundLabel: string;
  /**
   * 順位決定戦(3位決定戦など)の行なら、その印。本選の行は null。
   *
   * **本選と座標空間を共有している**ので、描画側はこれでブロックを切り出す
   * (round で分けると本選の決勝と同じラウンドに並んでしまう)。
   */
  placement: { depth: number; rank: number } | null;
  status: string;
  /**
   * 組み合わせ変更(接続の交換)で座標既定を上書きしている枠か。**閲覧者には座標の詳細は
   * 出さず、真偽値だけ**(この枠に描かれている接続線は実際のフローと異なる、という注記に使う)。
   */
  hasFeederOverride: boolean;
  /** この対戦を行う開催日程の表示名(「1日目」「予選」など)。対戦に個別の時刻は無い */
  sessionLabel: string;
  detectedStartAt: string | null;
  winnerDecidedBy: string | null;
  /**
   * 検知した候補バトルが勝利条件の最大試合数を超え、主催者の選択待ち。
   * **この状態だけ、下の NEEDS_REVIEW→LIVE の読み替えの例外として視聴者にも見せる**
   * (確定仕様)。選択操作自体は公開側に置かない — 表示のみ。
   */
  needsResultSelection: boolean;
  sides: BracketSideDto[];
};

/**
 * 座標既定(`nextSlot()`)と実際の勝者フローがずれている辺(=「接続の交換」で実効的に
 * 変わった辺)。管理画面・公開ページの黄色破線矢印だけに使う表示専用フィールドで、
 * `matchId`・参加者ID・`changedAt`(検知誤爆リスク期間の内部記録)は含めない。
 *
 * 座標は表の見た目(どの枠がどこにあるか)から自明であり秘匿情報ではないため、
 * 従来の「閲覧者には真偽値だけ」方針(`hasFeederOverride`)を最小限だけ緩めている
 * (`src/event/CLAUDE.md` 参照)。
 */
export type BracketFeederFlowDto = {
  from: { round: number; position: number };
  to: { round: number; position: number; sideIndex: number };
};

export type BracketDto = {
  roundCount: number;
  matches: BracketMatchDto[];
  feederFlows: BracketFeederFlowDto[];
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
      sessionId: true,
      detectedStartAt: true,
      detectedBattleId: true,
      detectionConfidence: true,
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
              participant: {
                select: {
                  id: true,
                  displayName: true,
                  roomId: true,
                  avatarOffsetX: true,
                  avatarOffsetY: true,
                  avatarZoom: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (matches.length === 0) return null;

  // 日程の表示名。名前が無ければ「N日目」。対戦カードは時刻ではなくこれを出す。
  const sessions = await prisma.eventSession.findMany({
    where: { eventId },
    orderBy: { startAt: "asc" },
    select: { id: true, name: true },
  });
  const sessionLabels = new Map(
    sessions.map((s, index) => [s.id, s.name || `${index + 1}日目`] as const)
  );

  // バトル前(SCHEDULED)の対戦だけ、出場者が今配信中かを見る。「接続中」発光の判定材料
  // (すでにバトルへ入っている対戦や確定済みの対戦には出さない)。
  const scheduledRoomIds = matches
    .filter((m) => m.status === "SCHEDULED")
    .flatMap((m) => m.sides.flatMap((s) => s.participants.map((p) => p.participant.roomId)));
  const liveRoomIds = await findLiveRoomIds(scheduledRoomIds);

  // TikTok 側のバトルスコア。公開側は誤解のコストが大きいので exact 検知のマッチだけに出す。
  // roomId は帰属の突き合わせにだけ使い、DTO には出さない。
  const tiktokScores = await loadMatchTiktokScores(
    prisma,
    matches
      .filter((m) => canShowTiktokScore(m, "public"))
      .map((m) => ({
        detectedBattleId: m.detectedBattleId,
        sides: m.sides.map((s) => ({
          sideId: s.id,
          roomIds: s.participants.map((p) => p.participant.roomId),
        })),
      }))
  );

  // 表示専用の矢印。**正本は `feederFlowEdges()`(内部で `buildWinnerFeederGraph()` を
  // 呼ぶfail closed経路)。** 独自の緩い解釈は作らず、失敗時は矢印を1本も返さない
  // (表自体は従来どおり描画を続ける)。対象は本選の行だけ(`bracket-swap-apply.ts` の
  // `swapWinnerFeeders()` と同じ絞り込み。順位決定戦ブロックは別の座標系として扱わない)。
  const mainRows = matches.filter((m) => !parsePlacement(m.rules));
  const mainRoundCount = mainRows.length > 0 ? Math.max(...mainRows.map((m) => m.round)) : 0;
  const feederFlowResult = feederFlowEdges(
    mainRows.map((m) => ({ round: m.round, bracketPosition: m.bracketPosition, rules: m.rules })),
    mainRoundCount
  );
  const feederFlows: BracketFeederFlowDto[] = feederFlowResult.ok
    ? feederFlowResult.edges.map((e): BracketFeederFlowDto => ({ from: e.from, to: e.to }))
    : [];

  return {
    roundCount: Math.max(...matches.map((m) => m.round)),
    feederFlows,
    matches: matches.map((m) => {
      const needsResultSelection =
        typeof (m.rules as { reviewReason?: unknown } | null)?.reviewReason === "string" &&
        (m.rules as { reviewReason: string }).reviewReason === "CANDIDATES_EXCEEDED";
      return {
      id: m.id,
      round: m.round,
      position: m.bracketPosition,
      roundLabel:
        typeof (m.rules as { roundLabel?: unknown } | null)?.roundLabel === "string"
          ? (m.rules as { roundLabel: string }).roundLabel
          : `${m.round}回戦`,
      placement: parsePlacement(m.rules),
      // NEEDS_REVIEW は通常「進行中(LIVE)」に読み替えて隠す。**候補過多で選択待ちの
      // 状態だけは例外**で、そのまま渡して視聴者にも「⚠ 結果確認中」を見せる(確定仕様)。
      status: m.status === "NEEDS_REVIEW" && !needsResultSelection ? "LIVE" : m.status,
      hasFeederOverride: (() => {
        const parsed = parseWinnerFeeders(m.rules);
        return !!parsed && parsed.ok;
      })(),
      sessionLabel: sessionLabels.get(m.sessionId) ?? "",
      detectedStartAt: m.detectedStartAt?.toISOString() ?? null,
      winnerDecidedBy: m.winnerDecidedBy,
      needsResultSelection,
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
          entrants: s.participants.map((p) => ({
            participantId: p.participant.id,
            displayName: p.participant.displayName,
            avatarOffsetX: p.participant.avatarOffsetX,
            avatarOffsetY: p.participant.avatarOffsetY,
            avatarZoom: p.participant.avatarZoom,
          })),
          diamonds: s.diamonds.toString(),
          tiktokScore: tiktokScores.get(s.id) ?? null,
          // 確定するまでは勝者を出さない(NEEDS_REVIEW のまま公開しない)。
          isWinner: m.status === "FINISHED" && m.winnerSideId === s.id,
          hasLiveStreamer:
            m.status === "SCHEDULED" &&
            s.participants.some((p) => liveRoomIds.has(p.participant.roomId)),
        };
      }),
      };
    }),
  };
}

/** デスマッチの残ライフ。ライフ順に並んでいる(獲得ダイヤの順位とは別物)。 */
export type LifeStandingDto = StandingDto & {
  current: number;
  max: number;
  eliminated: boolean;
};

/** 出場者一覧(プロフィールカード)用。既にloadEventSnapshotが取得済みのデータを流用する。 */
export type RosterParticipantDto = {
  id: string;
  displayName: string;
  tiktokId: string;
  teamId: string | null;
};

export type RosterTeamDto = { id: string; name: string; colorHex: string | null };

export type EventSnapshot = {
  standings: StandingDto[];
  /** デスマッチのときだけ入る。ライフ順(残ライフ → 脱落の遅さ → 獲得ダイヤ) */
  lives: LifeStandingDto[] | null;
  /** イベント全体のリスナー貢献(scope=EVENT) */
  eventContributions: ContributionDto[];
  participants: RosterParticipantDto[];
  /** チーム戦のときだけ意味を持つ。出場者一覧のチーム名表示に使う。 */
  teams: RosterTeamDto[];
  lastAggregatedAt: string | null;
  /** 倍率が設定されているか。ないならポイント表示を出さずダイヤだけ見せる */
  hasMultiplier: boolean;
  /**
   * このスナップショットが「検知したバトル区間のギフトだけ」で作られているか。
   *
   * **`format` から導かない。** `finalizedAt` が立った過去イベントは再集計されないので、
   * 旧方式(日程の全ギフト)のスナップショットがそのまま残る。種目で判定すると、
   * 過去のトーナメントに「バトル中のみ」という説明を付けてしまう。
   */
  battleOnly: boolean;
};

/**
 * `topParticipantId` は FK ではないので、名前は呼び出し側が持っている参加者一覧から引く。
 * 解決できない(参加者が抜けた直後など)ときは支援先を出さない。
 *
 * `breakdown` は保存形のまま信用せず `parseBreakdown()` を通す。壊れていれば null に落ちて
 * 従来表示へフォールバックする(公開ページを 500 にしない)。
 */
function toContributionDto(
  row: {
    listenerUniqueId: string;
    nickname: string;
    profileImageUrl: string | null;
    diamonds: bigint;
    points: unknown;
    giftCount: number;
    topParticipantId: string | null;
    participantCount: number;
    breakdown: unknown;
  },
  participantNameById: Map<string, string>
): ContributionDto {
  return {
    listenerUniqueId: row.listenerUniqueId,
    nickname: row.nickname,
    profileImageUrl: row.profileImageUrl,
    diamonds: row.diamonds.toString(),
    points: String(row.points),
    giftCount: row.giftCount,
    topParticipantName: row.topParticipantId
      ? (participantNameById.get(row.topParticipantId) ?? null)
      : null,
    participantCount: row.participantCount,
    breakdown: parseBreakdown(row.breakdown),
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
  aggregationPolicy: string | null;
}): Promise<EventSnapshot> {
  const subjectType = event.entryMode === "TEAM" ? "TEAM" : "PARTICIPANT";
  const battleOnly = event.aggregationPolicy === "BATTLE_ONLY";

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
      // バトル中のみ集計したスナップショットでは SOLO_STREAM(枠投げ)倍率が効いていない。
      // 数に入れると、その倍率しか持たないイベントで「ポイント順 / 実弾順」の切り替えが
      // 出るのに押しても並びが変わらない、という状態になる。
      prisma.eventMultiplier.count({
        where: { eventId: event.id, ...(battleOnly ? { kind: "BATTLE" } : {}) },
      }),
      event.format === "DEATHMATCH"
        ? prisma.eventLifePoint.findMany({
            where: { eventId: event.id, subjectType },
            select: { subjectId: true, current: true, max: true, eliminatedAt: true },
          })
        : Promise.resolve([]),
    ]);

  const participantById = new Map(participants.map((p) => [p.id, p]));
  const participantNameById = new Map(participants.map((p) => [p.id, p.displayName]));
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
    eventContributions: contributions.map((c) => toContributionDto(c, participantNameById)),
    participants: participants.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      tiktokId: p.tiktokId,
      teamId: p.teamId,
    })),
    teams: teams.map((t) => ({ id: t.id, name: t.name, colorHex: t.colorHex })),
    lastAggregatedAt: event.lastAggregatedAt?.toISOString() ?? null,
    hasMultiplier: multiplierCount > 0,
    battleOnly,
  };
}

/**
 * 参加者1人ぶんのリスナー貢献ランキング。
 * 支援先は自明(選択中の参加者そのもの)なので、この scope では常に出さない。
 */
export async function loadParticipantContributions(
  eventId: string,
  participantId: string
): Promise<ContributionDto[]> {
  const rows = await prisma.eventContribution.findMany({
    where: { eventId, scope: "PARTICIPANT", scopeId: participantId },
    orderBy: [{ points: "desc" }, { diamonds: "desc" }],
  });
  return rows.map((row) => toContributionDto(row, new Map()));
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
