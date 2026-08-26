import type { Prisma } from "@prisma/client";
import { fetchBattles, type DbClient } from "./analytics-db";
import {
  assignBattles,
  findMissedMatches,
  MANUAL_DECISIONS,
  type BattleObservation,
  type MatchCandidate,
} from "./match-detect";
import {
  isByeRow,
  isCandidatesConfirmedByOrganizer,
  isForceFullPeriod,
  parseLoserFrom,
  parseWinnerFeeders,
} from "./match-status";
import type { TimeRange } from "./scoring";
import { BATTLE_ACTION } from "@/lib/tiktok-battle";
import {
  buildWinnerFeederGraph,
  feederOf,
  BracketInconsistentError,
  type BracketSlot,
  type WinnerFeederGraph,
} from "./winner-feeders";

// analytics で観測されたバトルの取り込みと、対戦カードとの照合。
//
// 照合そのものは match-detect.ts の純粋関数が持つ。ここは DB の出し入れだけ。
//
// **`detectMatches` は候補(`EventMatchBattleCandidate`)を正しい状態に保つことだけに専念する。**
// `EventMatch.status` / `winnerSideId` / `decidedAt` の導出は一切行わない
// (`match-results.ts` の `resolveMatchSeries()` に一本化している)。唯一の例外は
// `NO_SHOW`(検知できなかったことの記録)。

/**
 * 対戦カードの時間枠より広めに取り込む(枠外で始まったバトルも見えるようにする)。
 *
 * 広げるのは**呼び出し側**(aggregate.ts が開催日程を前後に広げてつなぐ)。
 * ここで広げると、隣り合う日程を広げた区間が重なって同じバトルを二度 upsert する。
 */
export const BATTLE_INGEST_GRACE_MS = 60 * 60 * 1000;

/**
 * 参加者の room で観測されたバトルを DetectedBattle へ取り込む。
 *
 * analytics 側は room ごとに行を持つので、1つのバトルにつき最大で参加人数ぶんの行が入る。
 * 取り込みは冪等(roomId + battleId が一意キー)。
 *
 * `start` / `end` は**そのまま**使う。猶予(`BATTLE_INGEST_GRACE_MS`)を足すのは呼び出し側。
 */
export async function ingestBattles(
  tx: DbClient,
  params: { roomIds: string[]; start: Date; end: Date }
): Promise<number> {
  if (params.roomIds.length === 0) return 0;

  const rows = await fetchBattles(tx, {
    roomIds: params.roomIds,
    start: params.start,
    end: params.end,
  });

  for (const row of rows) {
    const data = {
      startedAt: row.startedAt,
      startedAtEstimated: row.startedAtEstimated,
      endedAt: row.endedAt,
      durationSec: row.durationSec,
      lastAction: row.action,
      hostUserIds: row.hostUserIds,
      hostDisplayIds: row.hostDisplayIds,
      hostScores: (row.hostScores ?? {}) as Prisma.InputJsonObject,
    };
    await tx.detectedBattle.upsert({
      where: { battleId_roomId: { battleId: row.battleId, roomId: row.roomId } },
      create: { battleId: row.battleId, roomId: row.roomId, ...data },
      update: data,
    });
  }

  return rows.length;
}

type MatchWithSides = {
  id: string;
  status: string;
  round: number;
  bracketPosition: number;
  session: { startAt: Date; endAt: Date } | null;
  detectedEndAt: Date | null;
  decidedAt: Date | null;
  winnerDecidedBy: string | null;
  rules: unknown;
  sides: {
    id: string;
    sideIndex: number;
    participants: { participant: { roomId: string } }[];
  }[];
};

/** ブラケットの座標 → その対戦。上流(feeder)を座標から引くために使う。 */
function bySlotIndex(matches: MatchWithSides[]): Map<string, MatchWithSides> {
  const bySlot = new Map<string, MatchWithSides>();
  for (const match of matches) bySlot.set(`${match.round}:${match.bracketPosition}`, match);
  return bySlot;
}

/**
 * その座標の対戦が決着した時刻。**不戦勝行は自分では時刻を持たない**ので、
 * さらに上流へ遡る(段階的不戦勝方式では不戦勝行が連続することがある)。
 * 見つからなければ null = 制約なし。
 */
function decidedAtOfSlot(
  round: number,
  position: number,
  bySlot: Map<string, MatchWithSides>,
  graph: WinnerFeederGraph,
  depth = 0
): Date | null {
  if (round < 1 || depth > 32) return null;
  const match = bySlot.get(`${round}:${position}`);
  if (!match) return null;

  // **decidedAt を優先する。** resolveMatchSeries() は決着(AGGREGATE)時に必ず decidedAt を
  // 書くので、通常はこちらだけで足りる。detectedEndAt へのフォールバックは、BYE 確定など
  // decidedAt を書かない経路への後方互換のため。
  const decided = match.decidedAt ?? match.detectedEndAt;
  if (decided) return decided;

  // 不戦勝(バトルが起きていない)行は時刻を持たない。その上流まで遡る。
  const upstream = upstreamSlots(match, graph)
    .map((slot) => decidedAtOfSlot(slot.round, slot.position, bySlot, graph, depth + 1))
    .filter((d): d is Date => !!d);
  if (upstream.length === 0) return null;
  return upstream.reduce((max, d) => (d > max ? d : max));
}

/**
 * この行に出場者を送り込んでくる上流の座標。
 *
 * 通常は `WinnerFeederGraph` 経由(`winnerFeeders` override があればそちら、無ければ
 * `nextSlot()` の逆算)。**順位決定戦の葉だけは例外**で、`rules.loserFrom`(本選のどの行の
 * 敗者が来るか)を見る — 座標の上流には何も無いので、そのままだと制約なし(null)になる。
 *
 * 上流のラウンドは必ず自分より小さいので、辿っても循環しない。
 */
function upstreamSlots(match: MatchWithSides, graph: WinnerFeederGraph): BracketSlot[] {
  const loserFrom = parseLoserFrom(match.rules);
  if (loserFrom) {
    return loserFrom.filter((slot): slot is BracketSlot => slot !== null);
  }
  return [0, 1]
    .map((sideIndex) => feederOf(graph, match.round, match.bracketPosition, sideIndex))
    .filter((slot): slot is BracketSlot => slot !== null);
}

/**
 * 上流(feeder)の決着時刻。
 *
 * これがないと、2回戦のカードが埋まった瞬間に「同じ組み合わせで前に行われたバトル」
 * (1回戦そのもの、練習バトル)が候補に入る。時間枠がラウンドを分けていた前提の代わり。
 *
 * 順位決定戦でも同じ危険がある — 3位決定戦の枠が埋まった瞬間に、その2人が過去に
 * 行った別のバトルを拾いうる。`upstreamSlots()` が `loserFrom` を見るのはそのため。
 *
 * **`match` 自身が `winnerFeeders` override を持つ場合、接続変更時刻(`changedAt`)も
 * 検知下限に含める**(`max(各feederの決着時刻, changedAt)`)。これが無いと、接続変更
 * "前" に発生した無関係なバトルが、新しい組み合わせの結果として誤検知される
 * (`src/event/CLAUDE.md` の「検知の誤爆対策」参照)。override 対象は非bye行に限定されているので、
 * bye行を透過した先でこの考慮が必要になることはない。
 */
function feederDecidedAt(
  match: MatchWithSides,
  bySlot: Map<string, MatchWithSides>,
  graph: WinnerFeederGraph
): Date | null {
  const feeders = upstreamSlots(match, graph)
    .map((slot) => decidedAtOfSlot(slot.round, slot.position, bySlot, graph))
    .filter((d): d is Date => !!d);

  const parsedOverride = parseWinnerFeeders(match.rules);
  const changedAt =
    parsedOverride && parsedOverride.ok ? new Date(parsedOverride.value.changedAt) : null;

  const candidates = changedAt ? [...feeders, changedAt] : feeders;
  if (candidates.length === 0) return null;
  return candidates.reduce((max, d) => (d > max ? d : max));
}

/** 日程が付いていない対戦(移行前のデータ)は検知しようがないので候補にしない。 */
function toCandidate(
  match: MatchWithSides,
  bySlot: Map<string, MatchWithSides>,
  graph: WinnerFeederGraph
): MatchCandidate | null {
  if (!match.session) return null;
  const bySide = [...match.sides].sort((a, b) => a.sideIndex - b.sideIndex);
  return {
    id: match.id,
    round: match.round,
    bracketPosition: match.bracketPosition,
    sessionStart: match.session.startAt,
    sessionEnd: match.session.endAt,
    sideRoomIds: bySide.map((s) => s.participants.map((p) => p.participant.roomId)),
    isBye: isByeRow(match.rules),
    // `lockedBattleId`(確定済みの割り当てを別の battleId へ動かさない)は候補テーブル
    // (`EventMatchBattleCandidate`)へ移したのでここには無い。候補の追加・削除で表現する。
    feederDecidedAt: feederDecidedAt(match, bySlot, graph),
  };
}

function toObservations(
  rows: {
    battleId: string;
    roomId: string;
    startedAt: Date;
    startedAtEstimated: boolean;
    endedAt: Date | null;
    durationSec: number | null;
  }[]
): BattleObservation[] {
  const grouped = new Map<string, BattleObservation>();
  for (const row of rows) {
    let entry = grouped.get(row.battleId);
    if (!entry) {
      entry = { battleId: row.battleId, rooms: [] };
      grouped.set(row.battleId, entry);
    }
    entry.rooms.push({
      roomId: row.roomId,
      startedAt: row.startedAt,
      startedAtEstimated: row.startedAtEstimated,
      endedAt: row.endedAt,
      // 開始が推定値のままなら「両端を観測できた」とは言えない。
      complete: !row.startedAtEstimated && row.endedAt !== null,
      durationSec: row.durationSec,
    });
  }
  return [...grouped.values()];
}

export type DetectionResult = {
  detected: number;
  missed: number;
  /**
   * 途中終了(CUT_SHORT)と判明したバトルに紐づいていたので解除した対戦の数。
   *
   * **呼び出し側はこれが 0 でない周回を最終集計にしないこと**(`aggregate.ts`)。
   * 解除した対戦の再検知は次の周回まで走らないため。
   */
  invalidated: number;
};

/**
 * 対戦カードと取り込んだバトルを突き合わせ、EventMatch へ反映する。
 *
 * - 主催者が VOID にしたマッチ、手動で勝者を確定したマッチには触らない
 * - **途中終了(CUT_SHORT)したバトルは候補の母集団から丸ごと外す。** 成立したバトルとして
 *   扱わない。すでに保存されている候補行(`EventMatchBattleCandidate`)は削除する
 * - 終了をまだ観測できていないバトルは**暫定候補**(`endedAt` は null のまま)として保存する。
 *   勝敗・状態(LIVE/NEEDS_REVIEW 等)の導出は `resolveMatchSeries()` の責務
 * - 今回のペアリングに現れなかった既存候補行(実際の終了が日程の外だった等)は削除する
 * - 日程が終わっても候補が1件も無いマッチは NO_SHOW にする(この関数が書く唯一の状態)
 */
export async function detectMatches(
  tx: DbClient,
  params: { eventId: string; now: Date }
): Promise<DetectionResult> {
  const matches = (await tx.eventMatch.findMany({
    where: { eventId: params.eventId },
    select: {
      id: true,
      status: true,
      round: true,
      bracketPosition: true,
      // 検知の対象区間は「割り当てた開催日程まるごと」。対戦に個別の時間枠は無い。
      session: { select: { startAt: true, endAt: true } },
      detectedEndAt: true,
      decidedAt: true,
      winnerDecidedBy: true,
      // 不戦勝行を検知に関わらせないため(toCandidate)。凍結判定(candidatesConfirmedByOrganizer)
      // にも使う。
      rules: true,
      sides: {
        select: {
          id: true,
          sideIndex: true,
          participants: { select: { participant: { select: { roomId: true } } } },
        },
      },
    },
  })) as MatchWithSides[];

  // **`status === "FINISHED"` では対象から外さない。** 自動確定(AGGREGATE)は日程が
  // 終わるまで検知を続け、超過が見つかったら resolveMatchSeries が差し戻す。
  // 凍結するのは主催者が候補選択を「確定した」マッチだけ(`reopen` で明示的に解除するまで)。
  const open = matches.filter(
    (m) =>
      m.status !== "VOID" &&
      !(m.winnerDecidedBy && MANUAL_DECISIONS.has(m.winnerDecidedBy)) &&
      !isCandidatesConfirmedByOrganizer(m.rules)
  );
  if (open.length === 0) return { detected: 0, missed: 0, invalidated: 0 };

  // 上流は**全マッチ**から引く(VOID や手動確定の行も上流にはなりうる)。
  const bySlot = bySlotIndex(matches);
  const roundCount = Math.max(...matches.map((m) => m.round));
  const feederGraph = buildWinnerFeederGraph(
    matches.map((m) => ({ round: m.round, bracketPosition: m.bracketPosition, rules: m.rules })),
    roundCount
  );
  if (!feederGraph.ok) throw new BracketInconsistentError();
  const graph = feederGraph.graph;

  const candidates = open
    .map((m) => toCandidate(m, bySlot, graph))
    .filter((c): c is MatchCandidate => c !== null);
  if (candidates.length === 0) return { detected: 0, missed: 0, invalidated: 0 };

  // 対象の room と、対象になりうる時間帯(日程の前後 grace)だけを読む。
  const starts = candidates.map((c) => c.sessionStart.getTime());
  const ends = candidates.map((c) => c.sessionEnd.getTime());
  const rows = await tx.detectedBattle.findMany({
    where: {
      roomId: {
        in: open.flatMap((m) =>
          m.sides.flatMap((s) => s.participants.map((p) => p.participant.roomId))
        ),
      },
      // 日程内に**終了した**バトルが対象。開始はそれより前にありうるので grace で広げる
      // (TikTok のバトルは長くても数十分なので、1時間で足りる)。
      startedAt: {
        gte: new Date(Math.min(...starts) - BATTLE_INGEST_GRACE_MS),
        lte: new Date(Math.max(...ends) + BATTLE_INGEST_GRACE_MS),
      },
    },
    select: {
      battleId: true,
      roomId: true,
      startedAt: true,
      startedAtEstimated: true,
      endedAt: true,
      durationSec: true,
      // 途中終了(CUT_SHORT)の判定に要る。**select し忘れると値が届かない。**
      lastAction: true,
    },
  });

  // **途中終了したバトルは成立したバトルとして扱わない。** room ごとに行が分かれていて、
  // 片側が途中接続で終了イベントを取り逃していれば lastAction は OPEN / UNKNOWN のまま
  // 残るので、**1つでも CUT_SHORT を観測した room があればそのバトル全体を除外する**
  // (summarize() の集約と同じ向き。判定できないものは従来どおり候補にする fail-open)。
  const cutShortBattleIds = new Set(
    rows.filter((r) => r.lastAction === BATTLE_ACTION.CUT_SHORT).map((r) => r.battleId)
  );

  const assignments = assignBattles({
    matches: candidates,
    battles: toObservations(rows.filter((r) => !cutShortBattleIds.has(r.battleId))),
  });

  // 既存候補行を読む(open マッチぶんだけ。candidatesConfirmedByOrganizer なマッチは
  // open に含まれないので、その候補行は自動的に触られない)。
  const existingCandidates = await tx.eventMatchBattleCandidate.findMany({
    where: { matchId: { in: open.map((m) => m.id) } },
    select: { id: true, matchId: true, battleId: true, ambiguous: true },
  });
  const existingByKey = new Map(existingCandidates.map((c) => [`${c.matchId}:${c.battleId}`, c]));
  const existingCountByMatch = new Map<string, number>();
  for (const c of existingCandidates) {
    existingCountByMatch.set(c.matchId, (existingCountByMatch.get(c.matchId) ?? 0) + 1);
  }

  const assignmentsByMatch = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = assignmentsByMatch.get(a.matchId);
    if (list) list.push(a);
    else assignmentsByMatch.set(a.matchId, [a]);
  }

  let invalidated = 0;

  for (const m of open) {
    const matchAssignments = assignmentsByMatch.get(m.id) ?? [];
    const keepKeys = new Set(matchAssignments.map((a) => `${m.id}:${a.battleId}`));

    for (const a of matchAssignments) {
      const key = `${m.id}:${a.battleId}`;
      const existing = existingByKey.get(key);
      await tx.eventMatchBattleCandidate.upsert({
        where: { matchId_battleId: { matchId: m.id, battleId: a.battleId } },
        create: {
          matchId: m.id,
          battleId: a.battleId,
          startedAt: a.startedAt,
          endedAt: a.endedAt,
          endedAtSource: a.endedAtSource,
          confidence: a.confidence,
          ambiguous: a.ambiguous,
        },
        update: {
          startedAt: a.startedAt,
          endedAt: a.endedAt,
          endedAtSource: a.endedAtSource,
          confidence: a.confidence,
          // **sticky。** 一度 ambiguous になったら「検知をやり直す」まで false へ戻さない
          // (片方のマッチが confirm で open から外れても、もう片方の判定が動かないように)。
          ambiguous: existing ? existing.ambiguous || a.ambiguous : a.ambiguous,
        },
      });
    }

    // 今回のペアリングに現れなかった既存候補は削除する
    // (CUT_SHORT による除外、実際の終了が日程外だった暫定候補の解除等)。
    const toDelete = existingCandidates.filter(
      (c) => c.matchId === m.id && !keepKeys.has(`${c.matchId}:${c.battleId}`)
    );
    if (toDelete.length > 0) {
      await tx.eventMatchBattleCandidate.deleteMany({
        where: { id: { in: toDelete.map((c) => c.id) } },
      });
      invalidated += toDelete.length;
    }
  }

  const assigned = new Set(assignments.map((a) => a.matchId));

  // 既存候補が1件以上あったのに今回0件になったマッチ(候補が全部消えた)を、
  // 「まだ何も検知していない」マッチと同じ扱いで NO_SHOW 候補に含める。
  const nowEmptyMatchIds = new Set(
    open
      .filter((m) => (existingCountByMatch.get(m.id) ?? 0) > 0 && !assigned.has(m.id))
      .map((m) => m.id)
  );

  const byId = new Map(open.map((m) => [m.id, m]));
  const missed = findMissedMatches({
    matches: candidates.filter((c) => {
      const m = byId.get(c.id);
      return m?.status === "SCHEDULED" || nowEmptyMatchIds.has(c.id);
    }),
    assigned,
    now: params.now,
  });

  if (missed.length > 0) {
    await tx.eventMatch.updateMany({
      where: { id: { in: missed }, status: "SCHEDULED" },
      data: { status: "NO_SHOW" },
    });
  }

  return {
    detected: assignments.length,
    missed: missed.length,
    invalidated,
  };
}

/**
 * 参加者(room)ごとのバトル区間を返す。
 *
 * **イベント全体で1本のリストにしてはいけない。** バトルは配信者ごとに起きるので、
 * 1人がバトル中というだけで同時刻の他の参加者にまで BATTLE 倍率がかかってしまう。
 *
 * **起点は `EventMatch` ではなく `EventMatchBattleCandidate`(`selected=true`)。**
 * `selected` は `resolveMatchSeries()` が計算した「現在の実効ゲーム集合」に一本化されて
 * いるので、候補過多で選択待ちの候補や、決着後に使われなかった余剰候補はここに現れない。
 * 対象マッチは VOID と NO_SHOW を含めない(バトルが成立していないので倍率の根拠がない)。
 *
 * **`rules.forceFullPeriod`(⚠️トラブル対処)が立っている対戦は例外。** 候補の区間を無視し、
 * 割り当てた開催日程まるごとを区間にする。バトル検知が失敗して手動確定した対戦のダイヤ
 * 救済に使う(`match-status.ts` の `isForceFullPeriod` を参照。設定は `route.ts` が
 * FINISHED の対戦にしか許さない)。**救済したいのはまさに「実効ゲームを1件も持たない対戦」
 * なので、候補テーブルからは引けない** — `EventMatch` を別に読んで日程を入れる。
 */
export async function loadBattleRangesByRoom(
  tx: DbClient,
  eventId: string
): Promise<Map<string, TimeRange[]>> {
  const candidates = await tx.eventMatchBattleCandidate.findMany({
    where: {
      selected: true,
      endedAt: { not: null },
      match: { eventId, status: { in: ["LIVE", "DETECTED", "FINISHED"] } },
    },
    select: {
      startedAt: true,
      endedAt: true,
      match: {
        select: {
          // 倍率区間は**割り当てた日程で切る**。日程の前から始まったバトルの、日程の外の
          // 部分にまでバトル倍率をかけない(勝敗の集計と同じ扱いに揃える)。
          session: { select: { startAt: true, endAt: true } },
          rules: true,
          sides: {
            select: { participants: { select: { participant: { select: { roomId: true } } } } },
          },
        },
      },
    },
  });

  const forced = await tx.eventMatch.findMany({
    where: { eventId, status: { in: ["LIVE", "DETECTED", "FINISHED"] } },
    select: {
      rules: true,
      session: { select: { startAt: true, endAt: true } },
      sides: {
        select: { participants: { select: { participant: { select: { roomId: true } } } } },
      },
    },
  });

  const byRoom = new Map<string, TimeRange[]>();
  const addRange = (
    sides: { participants: { participant: { roomId: string } }[] }[],
    range: TimeRange
  ) => {
    if (range.start >= range.end) return;
    for (const side of sides) {
      for (const p of side.participants) {
        const roomId = p.participant.roomId;
        const list = byRoom.get(roomId);
        if (list) list.push(range);
        else byRoom.set(roomId, [range]);
      }
    }
  };

  for (const candidate of candidates) {
    // ⚠️トラブル対処フラグが立った対戦は下で日程まるごとを入れる(区間を二重に持たせない)。
    if (isForceFullPeriod(candidate.match.rules)) continue;
    const session = candidate.match.session;
    const start =
      session && candidate.startedAt < session.startAt ? session.startAt : candidate.startedAt;
    const end = session && candidate.endedAt! > session.endAt ? session.endAt : candidate.endedAt!;
    addRange(candidate.match.sides, { start, end });
  }

  for (const match of forced) {
    if (!isForceFullPeriod(match.rules)) continue;
    // 日程を持たない対戦(移行前データ)は、日程が正本の区間そのものなので救済しようがない。
    if (!match.session) continue;
    addRange(match.sides, { start: match.session.startAt, end: match.session.endAt });
  }

  return byRoom;
}
