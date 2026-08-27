import {
  aggregateGiftsBySegment,
  fetchListenerProfiles,
  fetchRoomHostUserIds,
  type DbClient,
  type ListenerProfile,
} from "./analytics-db";
import { resolveSideTiktokScores, type BattleScoreRow, type ScoreSideInput } from "./battle-score";
import { buildSlotRows, type Bucket, type MatchListenerRow, type SlotInput } from "./match-contributions";
import { resolveGameWinner } from "./match-results";
import { parseMatchRules, seriesRequirement, type WinCondition } from "./match-rules";
import { isByeRow, parsePlacement, parseWinnerFeeders, reviewReasonOf } from "./match-status";
import { intersectWindows, resolveEventWindows, type EventWindow } from "./sessions";
import {
  buildRateSegments,
  FACTOR_SCALE,
  formatScaledPoints,
  scaledPoints,
  type MultiplierInput,
} from "./scoring";
import type { BracketEntrantDto } from "./public-event";

// 公開トーナメント表の対戦詳細ページ用ローダー。
//
// **対戦全体のバトルスコア(TikTok hostScore)合計は提供しない。** 既存の `loadMatchTiktokScores()`
// は `detectedBattleId`(=最後の有効バトルのミラー列)基準で、シリーズ合計ではない
// (2回目の設計レビューで指摘された誤り)。ここではバトル(`EventMatchBattleCandidate`)単位でだけ返す。
//
// **`EventMatchBattleCandidate.selected` だけで対戦の状態を判定しない。** `selected` は
// 「AGGREGATE判定の実効ゲーム集合」であって「検知済みかどうか」ではないため、手動確定
// (MANUAL)で候補が残っているケース等を `selected=0` だけで判定すると正当な対戦を
// NO_DETECTED_BATTLE に誤分類する(2回目の設計レビューで指摘)。状態分類は「候補配列が
// 空かどうか」で行い、返す候補は selected の値を問わず全件にする。
//
// **1バトルにつきギフト集計は1回だけ。** サイド合計・ゲーム勝者・リスナー別内訳を
// 同じ集計結果から同時に組み立てる(スコア計算と貢献者計算で二重にギフトを読まない)。

export type MatchBattleState =
  | "VOID"
  | "NO_SHOW"
  | "BYE"
  | "NO_DETECTED_BATTLE"
  | "MANUAL_WITHOUT_BATTLE_BREAKDOWN"
  | "AVAILABLE";

export function classifyMatchBattleState(match: {
  status: string;
  winnerDecidedBy: string | null;
  battleCandidateCount: number;
}): MatchBattleState {
  if (match.status === "VOID") return "VOID";
  if (match.status === "NO_SHOW") return "NO_SHOW";
  if (match.winnerDecidedBy === "BYE") return "BYE";
  if (match.battleCandidateCount === 0) {
    return match.winnerDecidedBy === "MANUAL" ? "MANUAL_WITHOUT_BATTLE_BREAKDOWN" : "NO_DETECTED_BATTLE";
  }
  return "AVAILABLE";
}

export type BattleSideBreakdown = {
  sideId: string;
  diamonds: string;
  points: string;
};

/** バトル単位の貢献者一覧。表示上限(既存 `MAX_CONTRIBUTION_ROWS` に倣う)を超えたら打ち切る。 */
const MAX_BATTLE_LISTENER_ROWS = 200;

export type BattleContributionSlot = {
  participantId: string;
  displayName: string;
  sideIndex: number;
  diamonds: string;
  points: string;
  giftCount: number;
  listeners: MatchListenerRow[];
  truncated: boolean;
};

export type BattleDetail = {
  candidateId: string;
  battleId: string;
  startedAt: string;
  endedAt: string | null;
  confidence: string;
  selected: boolean;
  /** 終了を観測済みで、かつその時刻が既に過去(`endedAt !== null && endedAt <= now`)。 */
  completed: boolean;
  /**
   * このゲーム単体の勝者。**対戦全体の公式勝者(`winnerSideId`)とは別物**
   * (MANUAL確定の対戦では一致しない場合がある)。
   */
  calculatedWinnerSideId: string | null;
  sides: BattleSideBreakdown[] | null;
  tiktokScores: Record<string, string>;
  contributions: BattleContributionSlot[] | null;
};

export type PublicMatchSideDto = {
  id: string;
  sideIndex: number;
  name: string | null;
  entrants: BracketEntrantDto[];
  isWinner: boolean;
  /** シリーズ全体(全バトル合計)のダイヤ。既存 `EventMatchSide.diamonds` そのもの。 */
  diamonds: string;
};

export type PublicMatchDetail = {
  id: string;
  round: number;
  position: number;
  roundLabel: string;
  placement: { depth: number; rank: number } | null;
  sessionLabel: string;
  status: string;
  winnerDecidedBy: string | null;
  decidedAt: string | null;
  isBye: boolean;
  hasFeederOverride: boolean;
  reviewReason: string | null;
  winCondition: WinCondition;
  winsNeeded: number;
  battleState: MatchBattleState;
  sides: PublicMatchSideDto[];
  battles: BattleDetail[];
  /** この応答を組み立てた時刻。長期キャッシュを避けているのでいつでも「ほぼ現在」。 */
  dataAsOf: string;
};

/** ローダーが要求するイベント側の最小情報。`findPublicEvent()` の戻り値はこれを満たす。 */
export type MatchDetailEventInput = {
  id: string;
  rules: unknown;
  /** 日程を1件も持たない旧イベントの `resolveEventWindows()` フォールバックに要る。 */
  startAt: Date;
  endAt: Date;
  sessions: { id: string; name: string | null; startAt: Date; endAt: Date }[];
};

function addBucket(map: Map<string, Bucket>, key: string, add: Bucket) {
  const cur = map.get(key);
  if (!cur) {
    map.set(key, { ...add });
    return;
  }
  cur.diamonds += add.diamonds;
  cur.points += add.points;
  cur.giftCount += add.giftCount;
}

/**
 * 1バトル(候補1件)の区間から、サイド別合計とリスナー別内訳を**1回のギフト集計**で
 * 同時に組み立てる。`match-results.ts` の `scoreSides()` と `match-contributions.ts` の
 * 集計ループを、対象キーが2種類(sideId / participantId×uniqueId)ある1本のループに統合したもの。
 */
async function scoreCandidate(
  client: DbClient,
  params: {
    sides: { id: string; sideIndex: number; participants: { participantId: string; roomId: string }[] }[];
    start: Date;
    end: Date;
    windows: EventWindow[];
    multipliers: MultiplierInput[];
  }
): Promise<{
  sideTotals: Map<string, { diamonds: bigint; points: bigint }>;
  byParticipant: Map<string, Map<string, Bucket>>;
}> {
  const roomToSide = new Map<string, string>();
  const roomToParticipant = new Map<string, string>();
  for (const side of params.sides) {
    for (const p of side.participants) {
      roomToSide.set(p.roomId, side.id);
      roomToParticipant.set(p.roomId, p.participantId);
    }
  }

  const sideTotals = new Map<string, { diamonds: bigint; points: bigint }>(
    params.sides.map((s) => [s.id, { diamonds: 0n, points: 0n }])
  );
  const byParticipant = new Map<string, Map<string, Bucket>>();

  const roomIds = [...roomToSide.keys()];
  if (roomIds.length === 0) return { sideTotals, byParticipant };

  const spans = intersectWindows({ start: params.start, end: params.end }, params.windows);

  for (const span of spans) {
    const segments = buildRateSegments({
      eventStart: span.start,
      eventEnd: span.end,
      multipliers: params.multipliers,
      battleRanges: [span],
    });

    for (const segment of segments) {
      const rows = await aggregateGiftsBySegment(client, {
        roomIds,
        start: segment.start,
        end: segment.end,
      });

      for (const row of rows) {
        const sideId = roomToSide.get(row.roomId);
        if (sideId) {
          const total = sideTotals.get(sideId);
          if (total) {
            total.diamonds += row.diamonds;
            total.points += scaledPoints(row.diamonds, segment.scaledFactor);
          }
        }

        const participantId = roomToParticipant.get(row.roomId);
        if (participantId) {
          let map = byParticipant.get(participantId);
          if (!map) {
            map = new Map<string, Bucket>();
            byParticipant.set(participantId, map);
          }
          addBucket(map, row.uniqueId, {
            diamonds: row.diamonds,
            points: scaledPoints(row.diamonds, segment.scaledFactor),
            giftCount: row.giftCount,
          });
        }
      }
    }
  }

  return { sideTotals, byParticipant };
}

function truncateContribution(row: {
  participantId: string;
  displayName: string;
  sideIndex: number;
  diamonds: string;
  points: string;
  giftCount: number;
  listeners: MatchListenerRow[];
}): BattleContributionSlot {
  const truncated = row.listeners.length > MAX_BATTLE_LISTENER_ROWS;
  return {
    ...row,
    listeners: truncated ? row.listeners.slice(0, MAX_BATTLE_LISTENER_ROWS) : row.listeners,
    truncated,
  };
}

type MatchRow = {
  id: string;
  round: number;
  bracketPosition: number;
  status: string;
  sessionId: string;
  winnerSideId: string | null;
  winnerDecidedBy: string | null;
  decidedAt: Date | null;
  rules: unknown;
  sides: {
    id: string;
    sideIndex: number;
    diamonds: bigint;
    team: { name: string } | null;
    participants: {
      participant: {
        id: string;
        displayName: string;
        roomId: string;
        avatarOffsetX: number | null;
        avatarOffsetY: number | null;
        avatarZoom: number | null;
      };
    }[];
  }[];
  battleCandidates: {
    id: string;
    battleId: string;
    startedAt: Date;
    endedAt: Date | null;
    confidence: string;
    selected: boolean;
  }[];
};

/**
 * 対戦1件ぶんの公開詳細を組み立てる。`{ id: matchId, eventId }` で検索するので、
 * 他イベントの matchId を渡されても引けない。対戦が無ければ null。
 *
 * トランザクションは取らない(表示専用の参照系。`match-contributions.ts` の
 * `loadMatchContributions()` と同じ思想 — 読んでいる最中に再検知が走ってもズレは
 * 次のポーリングで揃う)。
 */
export async function loadPublicMatchDetail(
  client: DbClient,
  params: { event: MatchDetailEventInput; matchId: string; now: Date }
): Promise<PublicMatchDetail | null> {
  const match = (await client.eventMatch.findFirst({
    where: { id: params.matchId, eventId: params.event.id },
    select: {
      id: true,
      round: true,
      bracketPosition: true,
      status: true,
      sessionId: true,
      winnerSideId: true,
      winnerDecidedBy: true,
      decidedAt: true,
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
      battleCandidates: {
        orderBy: { startedAt: "asc" },
        select: { id: true, battleId: true, startedAt: true, endedAt: true, confidence: true, selected: true },
      },
    },
  })) as MatchRow | null;
  if (!match) return null;

  const session = await client.eventSession.findUnique({
    where: { id: match.sessionId },
    select: { id: true, name: true, startAt: true, endAt: true },
  });

  const matchRules = parseMatchRules(params.event.rules);
  const { winsNeeded } = seriesRequirement(matchRules.winCondition);

  const battleState = classifyMatchBattleState({
    status: match.status,
    winnerDecidedBy: match.winnerDecidedBy,
    battleCandidateCount: match.battleCandidates.length,
  });

  const sessionLabel = session
    ? session.name ||
      `${params.event.sessions.findIndex((s) => s.id === session.id) + 1}日目`
    : "";

  const sides: PublicMatchSideDto[] = match.sides.map((s) => ({
    id: s.id,
    sideIndex: s.sideIndex,
    name:
      s.team?.name ??
      (s.participants.length > 0
        ? s.participants.map((p) => p.participant.displayName).join(" / ")
        : null),
    entrants: s.participants.map((p) => ({
      participantId: p.participant.id,
      displayName: p.participant.displayName,
      avatarOffsetX: p.participant.avatarOffsetX,
      avatarOffsetY: p.participant.avatarOffsetY,
      avatarZoom: p.participant.avatarZoom,
    })),
    isWinner: match.status === "FINISHED" && match.winnerSideId === s.id,
    diamonds: s.diamonds.toString(),
  }));

  let battles: BattleDetail[] = [];

  if (battleState === "AVAILABLE") {
    const windows: EventWindow[] = session
      ? [{ id: null, start: session.startAt, end: session.endAt, name: session.name }]
      : resolveEventWindows(params.event);

    const multiplierRows = await client.eventMultiplier.findMany({
      where: { eventId: params.event.id },
      select: { kind: true, factor: true, startAt: true, endAt: true },
    });
    const multipliers: MultiplierInput[] = multiplierRows.map((m) => ({
      kind: m.kind,
      factor: m.factor.toString(),
      startAt: m.startAt,
      endAt: m.endAt,
    }));

    const slots: SlotInput[] = match.sides.flatMap((side) =>
      side.participants.map((p) => ({
        participantId: p.participant.id,
        displayName: p.participant.displayName,
        tiktokId: p.participant.roomId,
        sideIndex: side.sideIndex,
      }))
    );
    const sideParticipants = match.sides.map((s) => ({
      id: s.id,
      sideIndex: s.sideIndex,
      participants: s.participants.map((p) => ({
        participantId: p.participant.id,
        roomId: p.participant.roomId,
      })),
    }));

    const completedCandidates = match.battleCandidates.filter(
      (c) => c.endedAt !== null && c.endedAt <= params.now
    );

    // TikTokスコアは全completed候補ぶんをまとめて一括取得する(N+1回避)。
    const roomIds = [...new Set(sideParticipants.flatMap((s) => s.participants.map((p) => p.roomId)))];
    const battleIds = completedCandidates
      .filter((c) => c.confidence === "exact")
      .map((c) => c.battleId);
    const [scoreRows, hostUserIdByRoomId] = await Promise.all([
      battleIds.length > 0
        ? client.detectedBattle.findMany({
            where: { battleId: { in: battleIds } },
            select: { battleId: true, hostUserIds: true, hostScores: true },
          })
        : Promise.resolve([]),
      fetchRoomHostUserIds(client, roomIds),
    ]);
    const scoreRowsByBattleId = new Map<string, BattleScoreRow[]>();
    for (const row of scoreRows) {
      const list = scoreRowsByBattleId.get(row.battleId);
      if (list) list.push(row);
      else scoreRowsByBattleId.set(row.battleId, [row]);
    }
    const scoreSideInputs: ScoreSideInput[] = sideParticipants.map((s) => ({
      sideId: s.id,
      roomIds: s.participants.map((p) => p.roomId),
    }));

    battles = await Promise.all(
      match.battleCandidates.map(async (candidate): Promise<BattleDetail> => {
        const completed = candidate.endedAt !== null && candidate.endedAt <= params.now;

        let sideBreakdown: BattleSideBreakdown[] | null = null;
        let calculatedWinnerSideId: string | null = null;
        let contributions: BattleContributionSlot[] | null = null;

        if (completed && candidate.endedAt) {
          const { sideTotals, byParticipant } = await scoreCandidate(client, {
            sides: sideParticipants,
            start: candidate.startedAt,
            end: candidate.endedAt,
            windows,
            multipliers,
          });

          sideBreakdown = [...sideTotals.entries()].map(([sideId, t]) => ({
            sideId,
            diamonds: t.diamonds.toString(),
            points: formatScaledPoints(t.points),
          }));
          calculatedWinnerSideId = resolveGameWinner(
            [...sideTotals.entries()].map(([sideId, t]) => ({ sideId, diamonds: t.diamonds }))
          );

          const spans = intersectWindows({ start: candidate.startedAt, end: candidate.endedAt }, windows);
          if (spans.length > 0) {
            const profiles: Map<string, ListenerProfile> = await fetchListenerProfiles(client, {
              roomIds,
              start: spans[0].start,
              end: spans[spans.length - 1].end,
            });
            contributions = buildSlotRows(slots, byParticipant, profiles).map(truncateContribution);
          } else {
            contributions = [];
          }
        }

        let tiktokScores: Record<string, string> = {};
        if (completed && candidate.confidence === "exact") {
          const matchRows = scoreRowsByBattleId.get(candidate.battleId) ?? [];
          const resolved = resolveSideTiktokScores({
            rows: matchRows,
            sides: scoreSideInputs,
            hostUserIdByRoomId,
          });
          tiktokScores = Object.fromEntries(resolved);
        }

        return {
          candidateId: candidate.id,
          battleId: candidate.battleId,
          startedAt: candidate.startedAt.toISOString(),
          endedAt: candidate.endedAt?.toISOString() ?? null,
          confidence: candidate.confidence,
          selected: candidate.selected,
          completed,
          calculatedWinnerSideId,
          sides: sideBreakdown,
          tiktokScores,
          contributions,
        };
      })
    );
  }

  return {
    id: match.id,
    round: match.round,
    position: match.bracketPosition,
    roundLabel:
      typeof (match.rules as { roundLabel?: unknown } | null)?.roundLabel === "string"
        ? (match.rules as { roundLabel: string }).roundLabel
        : `${match.round}回戦`,
    placement: parsePlacement(match.rules),
    sessionLabel,
    status: match.status,
    winnerDecidedBy: match.winnerDecidedBy,
    decidedAt: match.decidedAt?.toISOString() ?? null,
    isBye: isByeRow(match.rules) || match.winnerDecidedBy === "BYE",
    hasFeederOverride: (() => {
      const parsed = parseWinnerFeeders(match.rules);
      return !!parsed && parsed.ok;
    })(),
    reviewReason: reviewReasonOf(match.rules),
    winCondition: matchRules.winCondition,
    winsNeeded,
    battleState,
    sides,
    battles,
    dataAsOf: params.now.toISOString(),
  };
}

// --- サーバー側キャッシュ + 同時要求の集約 --------------------------------------------
//
// 認証不要の公開エンドポイントなので、`src/lib/tiktok-existence.ts` と同じ
// 「短いTTL・同時要求の相乗り・件数上限」の組み合わせで軽量に間引く。
// 完全な分散キャッシュ(Redis等)は複数レプリカ構成で初めて要る話で、単一プロセスの
// 間引きとしては過剰なので導入しない(1レプリカ運用であればこれで十分に効く)。

const CACHE_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 500;

type CacheEntry = { value: PublicMatchDetail | null; expiresAt: number };

function cacheKey(eventId: string, matchId: string): string {
  return `${eventId}:${matchId}`;
}

function createMatchDetailCache() {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<PublicMatchDetail | null>>();

  return {
    async load(
      client: DbClient,
      params: { event: MatchDetailEventInput; matchId: string; now: Date }
    ): Promise<PublicMatchDetail | null> {
      const key = cacheKey(params.event.id, params.matchId);
      const now = Date.now();

      const cached = cache.get(key);
      if (cached && cached.expiresAt > now) return cached.value;

      const pending = inFlight.get(key);
      if (pending) return pending;

      const promise = loadPublicMatchDetail(client, params)
        .then((value) => {
          for (const [k, v] of cache) {
            if (v.expiresAt <= now) cache.delete(k);
          }
          cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
          while (cache.size > MAX_CACHE_ENTRIES) {
            const oldest = cache.keys().next();
            if (oldest.done) break;
            cache.delete(oldest.value);
          }
          return value;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, promise);
      return promise;
    },
  };
}

// Next.js の dev サーバーはモジュールを再評価するので、globalThis に置いて使い回す
// (src/lib/tiktok-existence.ts と同じ理由)。
const globalForMatchDetail = globalThis as unknown as {
  __matchDetailCache?: ReturnType<typeof createMatchDetailCache>;
};

export const matchDetailCache =
  globalForMatchDetail.__matchDetailCache ?? createMatchDetailCache();

if (process.env.NODE_ENV !== "production") globalForMatchDetail.__matchDetailCache = matchDetailCache;
