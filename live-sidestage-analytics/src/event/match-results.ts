import type { Prisma } from "@prisma/client";
import { aggregateGiftsBySegment, type DbClient } from "./analytics-db";
import { nextSlot } from "./bracket";
import { MANUAL_DECISIONS } from "./match-detect";
import {
  isByeRow,
  isCandidatesConfirmedByOrganizer,
  isStartedMatch,
  mergeReviewReason,
  reviewReasonOf,
} from "./match-status";
import { seriesRequirement, type MatchRules } from "./match-rules";
import { intersectWindows, type EventWindow } from "./sessions";
import {
  buildRateSegments,
  formatScaledPoints,
  scaledPoints,
  type MultiplierInput,
} from "./scoring";

// 検知したバトルの勝敗確定と、トーナメント表の進行。
//
// **勝敗は TikTok の hostScore ではなく、当サービスが gifts から集計したダイヤで決める。**
// 集計の出所を1つに揃えるため。hostScore は DetectedBattle に参考値として残してあり、
// 大きく食い違ったときの取りこぼし検知に使う(match-detect.ts の scoreDivergence)。
//
// **勝利条件(1本勝負/2本先取)の判定は `resolveMatchSeries()` に一本化する。** 対戦カード
// 1件につき複数の候補バトル(`EventMatchBattleCandidate`)を持ちうるため、「先取条件に
// 到達するまでの候補の並び」を「実効ゲーム集合(effectiveGames)」と呼び、決着判定・
// `decidedAt`・サイド合計・BATTLE_ONLY 用の区間のすべてがこの集合だけを参照する
// (`EventMatchBattleCandidate.selected` 列に一本化。詳細は src/event/CLAUDE.md)。
//
// 進行は増分ではなく**毎回の再構築**。主催者が勝者を変えたり VOID にしたりしたときに、
// 下流へ流れた古い勝者が残らないようにするため(集計本体と同じ思想)。

export type MatchResultSummary = {
  finished: number;
  /** 同点で勝者を決められなかったマッチ。主催者の手動確定に回す */
  tied: number;
  /** 上流の結果が変わったが、下流が始まっているため反映できなかったマッチ */
  blocked: number;
  /**
   * 下流へ勝者を実際に転送した(サイドの出場者・チームを書き換えた、または不戦勝行を
   * 自動確定した)件数。
   *
   * **`aggregate.ts` はこれが 0 でない周回で `finalizedAt` を立てない。** 転送そのものは
   * 1回の呼び出しで全ラウンド伝播しきるが、**新しく埋まった枠のバトル検知は次の周**に
   * なる(検知は進行より先に走る)。ここで打ち切ると、締切後に表を作り直したときに
   * 「1回戦を確定して2回戦へ送った周回でそのまま最終集計になり、2回戦以降が永久に
   * SCHEDULED」になる。
   *
   * **`blocked` はここに数えない。** 下流が始まっている枠は毎周「転送したい」状態のまま
   * なので、数えると `finalizedAt` が永久に立たなくなる。
   */
  advanced: number;
};

type SideRow = {
  id: string;
  sideIndex: number;
  teamId: string | null;
  participants: { participantId: string; participant: { roomId: string } }[];
};

type CandidateRow = {
  id: string;
  battleId: string;
  startedAt: Date;
  endedAt: Date | null;
  endedAtSource: string | null;
  confidence: string;
  ambiguous: boolean;
  organizerSelected: boolean;
};

type MatchWithCandidates = {
  id: string;
  round: number;
  bracketPosition: number;
  status: string;
  matchType: string;
  winnerSideId: string | null;
  winnerDecidedBy: string | null;
  rules: unknown;
  session: { startAt: Date; endAt: Date; name: string | null } | null;
  sides: SideRow[];
  battleCandidates: CandidateRow[];
};

/**
 * 検知が終わったマッチのスコアを確定し、勝者を決め、トーナメント表を進める。
 *
 * 集計トランザクションの中から呼ぶ。
 */
export async function resolveMatchResults(
  tx: DbClient,
  params: {
    eventId: string;
    matchRules: MatchRules;
    multipliers: MultiplierInput[];
    /** 開催日程。検知区間がここからはみ出したぶんは勝敗に数えない */
    windows: EventWindow[];
    now: Date;
  }
): Promise<MatchResultSummary> {
  const matches = (await tx.eventMatch.findMany({
    where: { eventId: params.eventId },
    orderBy: [{ round: "asc" }, { bracketPosition: "asc" }],
    select: {
      id: true,
      round: true,
      bracketPosition: true,
      status: true,
      matchType: true,
      winnerSideId: true,
      winnerDecidedBy: true,
      rules: true,
      // 勝敗に数えるギフトは**この対戦を行う日程の中だけ**。イベントの全日程と
      // 交差させると、別の日程にはみ出したバトルのギフトまで勝敗に効く。
      session: { select: { startAt: true, endAt: true, name: true } },
      sides: {
        orderBy: { sideIndex: "asc" },
        select: {
          id: true,
          sideIndex: true,
          teamId: true,
          participants: {
            select: { participantId: true, participant: { select: { roomId: true } } },
          },
        },
      },
      battleCandidates: {
        orderBy: { startedAt: "asc" },
        select: {
          id: true,
          battleId: true,
          startedAt: true,
          endedAt: true,
          endedAtSource: true,
          confidence: true,
          ambiguous: true,
          organizerSelected: true,
        },
      },
    },
  })) as MatchWithCandidates[];

  if (matches.length === 0) return { finished: 0, tied: 0, blocked: 0, advanced: 0 };

  const summary: MatchResultSummary = { finished: 0, tied: 0, blocked: 0, advanced: 0 };

  // 下流(次ラウンド)が着手済みかの判定に使う。advanceBracket と同じ座標系。
  const roundCount = Math.max(...matches.map((m) => m.round));
  const slotIndex = new Map(matches.map((m) => [`${m.round}:${m.bracketPosition}`, m]));

  // ------------------------------------------------------------------
  // 1. 候補バトルから勝敗を確定する(resolveMatchSeries に一本化)
  // ------------------------------------------------------------------
  for (const match of matches) {
    if (match.winnerDecidedBy && MANUAL_DECISIONS.has(match.winnerDecidedBy)) continue;
    if (match.status === "VOID" || match.status === "NO_SHOW") continue;
    // 対象は「候補が1件以上あるか、上の除外に当てはまらないマッチ全部」
    // (候補が0件でも SCHEDULED へ戻す後始末を resolveMatchSeries 側で行うため対象に含める)。

    const slot = nextSlot(match.round, match.bracketPosition, roundCount);
    const downstream = slot ? slotIndex.get(`${slot.round}:${slot.position}`) : undefined;
    const downstreamStarted = downstream
      ? isStartedMatch({
          status: downstream.status,
          winnerDecidedBy: downstream.winnerDecidedBy,
          isBye: isByeRow(downstream.rules),
        })
      : false;

    const result = await resolveMatchSeries(tx, {
      match,
      matchRules: params.matchRules,
      multipliers: params.multipliers,
      windows: params.windows,
      now: params.now,
      downstreamStarted,
    });

    if (result.decided) summary.finished++;
    if (result.tied) summary.tied++;
  }

  // ------------------------------------------------------------------
  // 2. トーナメント表の進行
  // ------------------------------------------------------------------
  const advance = await advanceBracket(tx, params.eventId);
  summary.blocked += advance.blocked;
  summary.advanced += advance.advanced;

  return summary;
}

/**
 * 対戦カード1件ぶんの候補バトル(`EventMatchBattleCandidate`)から、勝利条件を踏まえて
 * 勝敗・状態を確定する。**採点はキャッシュしない** — 呼ばれるたびに `scoreSides()` で
 * 毎回計算する(全期間再計算という既存の集計哲学に合わせる)。
 *
 * `selectCandidates` / `resetCandidates` API からも同じトランザクション内で呼ばれる
 * (`advanceBracket` が集計ワーカーと API route の両方から呼ばれるのと同じパターン)。
 */
export async function resolveMatchSeries(
  tx: DbClient,
  params: {
    match: MatchWithCandidates;
    matchRules: MatchRules;
    multipliers: MultiplierInput[];
    windows: EventWindow[];
    now: Date;
    /** この対戦の勝者が送られる先(次ラウンド)が着手済みか。候補過多の差し戻し可否に使う。 */
    downstreamStarted: boolean;
  }
): Promise<{ decided: boolean; tied: boolean }> {
  const { match, matchRules, multipliers, windows, now, downstreamStarted } = params;

  if (match.winnerDecidedBy && MANUAL_DECISIONS.has(match.winnerDecidedBy)) {
    return { decided: false, tied: false };
  }
  if (match.status === "VOID") return { decided: false, tied: false };

  const { maxGames, winsNeeded } = seriesRequirement(matchRules.winCondition);
  const candidates = match.battleCandidates;

  // 3. 候補が0件。もともと SCHEDULED ならそのまま何もしない(無駄な書き込みを避ける)。
  if (candidates.length === 0) {
    // **下流が既に進んでいるなら差し戻さない。** ここに来る=候補が消えたのは、通常
    // 「以前 FINISHED(AGGREGATE)だった対戦の唯一の決着根拠が CUT_SHORT と判明した」
    // ケースで、`downstreamStarted` が true ならこの対戦は既に勝者を下流へ送っている
    // (候補過多の差し戻し、7. と同じ安全策)。
    if (downstreamStarted) {
      return { decided: false, tied: false };
    }
    if (
      match.status !== "SCHEDULED" ||
      match.winnerSideId !== null ||
      reviewReasonOf(match.rules) !== null
    ) {
      await tx.eventMatch.update({
        where: { id: match.id },
        data: {
          status: "SCHEDULED",
          winnerSideId: null,
          winnerDecidedBy: null,
          decidedAt: null,
          detectedBattleId: null,
          detectedStartAt: null,
          detectedEndAt: null,
          detectionConfidence: null,
          detectedEndSource: null,
          rules: mergeReviewReason(match.rules, null) as Prisma.InputJsonObject,
        },
      });
      await tx.eventMatchSide.updateMany({
        where: { matchId: match.id },
        data: { diamonds: 0, score: 0 },
      });
    }
    return { decided: false, tied: false };
  }

  // 4. cross-match衝突(sticky)。自動集計対象から丸ごと除外する。
  if (candidates.some((c) => c.ambiguous)) {
    await tx.eventMatchBattleCandidate.updateMany({
      where: { matchId: match.id },
      data: { selected: false },
    });
    await tx.eventMatch.update({
      where: { id: match.id },
      data: {
        status: "NEEDS_REVIEW",
        winnerSideId: null,
        winnerDecidedBy: null,
        decidedAt: null,
        rules: mergeReviewReason(match.rules, "AMBIGUOUS") as Prisma.InputJsonObject,
      },
    });
    await tx.eventMatchSide.updateMany({
      where: { matchId: match.id },
      data: { diamonds: 0, score: 0 },
    });
    return { decided: false, tied: false };
  }

  const organizerCurated = isCandidatesConfirmedByOrganizer(match.rules);
  const pool = organizerCurated ? candidates.filter((c) => c.organizerSelected) : candidates;

  // **終了時刻が確定していても、その時刻がまだ未来なら「進行中」として扱う。**
  // duration から終了時刻を計算した OPEN 状態のバトル(旧 detectMatches の
  // `a.endedAt > params.now` 判定を踏襲)。ここで resolved に含めて採点してしまうと、
  // まだ終わっていないバトルの結果を先取りして確定させてしまう。
  const resolved = pool.filter((c) => c.endedAt !== null && c.endedAt <= now);
  const pending = pool.filter((c) => c.endedAt === null || c.endedAt > now);

  // 7. 候補数超過(主催者確定前だけ判定する)。
  if (!organizerCurated && resolved.length > maxGames) {
    if (downstreamStarted) {
      // 下流が既に進んでいる。上流下流の不整合を避けるため、差し戻さず既存結果を維持する。
      return { decided: false, tied: false };
    }
    await tx.eventMatchBattleCandidate.updateMany({
      where: { matchId: match.id },
      data: { selected: false },
    });
    await tx.eventMatch.update({
      where: { id: match.id },
      data: {
        status: "NEEDS_REVIEW",
        winnerSideId: null,
        winnerDecidedBy: null,
        decidedAt: null,
        rules: mergeReviewReason(match.rules, "CANDIDATES_EXCEEDED") as Prisma.InputJsonObject,
      },
    });
    await tx.eventMatchSide.updateMany({
      where: { matchId: match.id },
      data: { diamonds: 0, score: 0 },
    });
    return { decided: false, tied: false };
  }

  // 8. 部分一致・2vs2は主催者の承認を待つ(承認後=DETECTED/FINISHEDになるまでは確定させない)。
  const hasNonExact = resolved.some((c) => c.confidence === "partial") || match.matchType === "2V2";
  if (hasNonExact && match.status !== "DETECTED" && match.status !== "FINISHED") {
    const reason = match.matchType === "2V2" ? "TEAM_BATTLE" : "PARTIAL";
    // **ミラー列も更新する。** スコア(サイド合計)は書かないが、検知時刻・信頼度は
    // 主催者の承認画面に必要(既存 UI がここを見て「検知: …」を出す)。
    const mirrorFirst = pool[0];
    const mirrorLast = pool[pool.length - 1];
    await tx.eventMatch.update({
      where: { id: match.id },
      data: {
        status: "NEEDS_REVIEW",
        detectedBattleId: mirrorLast.battleId,
        detectedStartAt: mirrorFirst.startedAt,
        detectedEndAt: mirrorLast.endedAt,
        detectionConfidence: mirrorLast.confidence,
        detectedEndSource: mirrorLast.endedAtSource,
        rules: mergeReviewReason(match.rules, reason) as Prisma.InputJsonObject,
      },
    });
    return { decided: false, tied: false };
  }

  // 9. 実効ゲーム集合(effectiveGames)を計算する。**毎回 scoreSides() で採点する**
  //    (キャッシュしない)。どちらかが winsNeeded に達した時点で打ち切り、それ以降の
  //    resolved 候補は無視する(誤って多すぎる候補が紛れても決着時刻がずれないため)。
  const sideTotals = new Map<string, { diamonds: bigint; points: bigint }>(
    match.sides.map((s) => [s.id, { diamonds: 0n, points: 0n }])
  );
  const sideWins = new Map<string, number>();
  const effectiveGames: CandidateRow[] = [];
  let decidedWinnerSideId: string | null = null;

  for (const candidate of resolved) {
    const totals = await scoreSides(tx, {
      sides: match.sides,
      start: candidate.startedAt,
      end: candidate.endedAt!,
      windows: match.session
        ? [
            {
              id: null,
              start: match.session.startAt,
              end: match.session.endAt,
              name: match.session.name,
            },
          ]
        : windows,
      multipliers,
    });

    effectiveGames.push(candidate);
    for (const t of totals) {
      const acc = sideTotals.get(t.sideId);
      if (!acc) continue;
      acc.diamonds += t.diamonds;
      acc.points += t.points;
    }

    // 個々のゲームの勝者は倍率適用前のダイヤで決める(match-results.ts 冒頭のコメント参照)。
    const best = totals.reduce((a, b) => (b.diamonds > a.diamonds ? b : a), totals[0]);
    const tie = totals.filter((t) => t.diamonds === best.diamonds).length > 1;
    const gameWinnerSideId = tie || best.diamonds === 0n ? null : best.sideId;

    if (gameWinnerSideId) {
      const wins = (sideWins.get(gameWinnerSideId) ?? 0) + 1;
      sideWins.set(gameWinnerSideId, wins);
      if (wins >= winsNeeded) {
        decidedWinnerSideId = gameWinnerSideId;
        break;
      }
    }
  }

  // 10. selected を effectiveGames に一本化する(loadBattleRangesByRoom はこの列だけを見る)。
  const effectiveIds = new Set(effectiveGames.map((g) => g.id));
  await tx.eventMatchBattleCandidate.updateMany({
    where: { matchId: match.id },
    data: { selected: false },
  });
  if (effectiveIds.size > 0) {
    await tx.eventMatchBattleCandidate.updateMany({
      where: { matchId: match.id, id: { in: [...effectiveIds] } },
      data: { selected: true },
    });
  }

  for (const [sideId, totals] of sideTotals) {
    await tx.eventMatchSide.update({
      where: { id: sideId },
      data: { diamonds: totals.diamonds, score: formatScaledPoints(totals.points) },
    });
  }

  if (decidedWinnerSideId) {
    // 11. 決着した。
    const firstGame = effectiveGames[0];
    const lastGame = effectiveGames[effectiveGames.length - 1];
    await tx.eventMatch.update({
      where: { id: match.id },
      data: {
        winnerSideId: decidedWinnerSideId,
        winnerDecidedBy: "AGGREGATE",
        status: "FINISHED",
        decidedAt: lastGame.endedAt,
        detectedBattleId: lastGame.battleId,
        detectedStartAt: firstGame.startedAt,
        detectedEndAt: lastGame.endedAt,
        detectionConfidence: lastGame.confidence,
        detectedEndSource: lastGame.endedAtSource,
        rules: mergeReviewReason(match.rules, null) as Prisma.InputJsonObject,
      },
    });
    return { decided: true, tied: false };
  }

  // 12. 未決着。
  const sessionEnded = match.session ? match.session.endAt <= now : false;
  let status: string;
  let reviewReason: string | null = null;
  if (pending.length > 0) {
    if (sessionEnded) {
      status = "NEEDS_REVIEW";
      reviewReason = "END_UNKNOWN";
    } else {
      status = "LIVE";
    }
  } else {
    // pending が無い(候補が最大試合数に届かない、または日程が終わって決着不能)。
    // 新しい reviewReason は付けない — 既存の「同点は自動確定しない」動作と同じ扱い。
    status = "DETECTED";
  }

  // ミラー列は現時点の pool(resolved + pending、startedAt 順)の範囲。pending が最後
  // なら detectedEndAt は null のまま(LIVE 表示に使う)。
  const mirrorFirst = pool[0];
  const mirrorLast = pool[pool.length - 1];

  await tx.eventMatch.update({
    where: { id: match.id },
    data: {
      winnerSideId: null,
      winnerDecidedBy: null,
      decidedAt: null,
      status,
      detectedBattleId: mirrorLast.battleId,
      detectedStartAt: mirrorFirst.startedAt,
      detectedEndAt: mirrorLast.endedAt,
      detectionConfidence: mirrorLast.confidence,
      detectedEndSource: mirrorLast.endedAtSource,
      rules: mergeReviewReason(match.rules, reviewReason) as Prisma.InputJsonObject,
    },
  });

  return { decided: false, tied: pending.length === 0 && effectiveGames.length > 0 };
}

/**
 * 確定した勝者をトーナメント表の下流へ送る。増分ではなく**毎回の再構築**。
 *
 * **呼び出し側の同一トランザクション内で、`acquireEventLock()` を取った後にだけ呼ぶこと。**
 * ロックの外で呼ぶと、10秒ごとに status を書き換える集計ワーカーや、表を丸ごと作り直す
 * `POST /matches` と競合したときに、古い値で通した判定がそのままコミットされる。
 *
 * 呼び出し元は集計ループ(`resolveMatchResults`)だけでなく、**結果を動かす主催者の操作**
 * (`[matchId]` の PATCH、`createBracket`)も含む。集計ワーカーは開催前(`SCHEDULED`)の
 * イベントを対象にしないので、ワーカー任せにすると事前に組んだ表が永久に進まない。
 *
 * **1回の呼び出しで全ラウンド伝播しきる。** DB を更新したら、読み込んだスナップショット
 * (`fresh`)も同じ内容へ**その場で**書き換えること。書き換えないと、不戦勝行を確定しても
 * その行自身を処理するときに更新前の値を見てしまい、その先へ勝者が流れない(段階的不戦勝
 * 方式では不戦勝が複数ラウンドにわたる)。`slotIndex` は `fresh` と同じオブジェクトを
 * 指しているので、**必ず in-place で書き換える** — `{...target}` で置き換えると
 * 片方にしか反映されず1パス収束が壊れる。
 */
export async function advanceBracket(
  tx: DbClient,
  eventId: string
): Promise<{ blocked: number; advanced: number }> {
  const summary = { blocked: 0, advanced: 0 };

  const fresh = await tx.eventMatch.findMany({
    where: { eventId },
    orderBy: [{ round: "asc" }, { bracketPosition: "asc" }],
    select: {
      id: true,
      round: true,
      bracketPosition: true,
      status: true,
      winnerSideId: true,
      // isStartedMatch が旧データの不戦勝行(rules.bye を持たない)を判別するのに要る。
      winnerDecidedBy: true,
      rules: true,
      sides: {
        orderBy: { sideIndex: "asc" },
        select: {
          id: true,
          sideIndex: true,
          teamId: true,
          participants: {
            select: { participantId: true, participant: { select: { roomId: true } } },
          },
        },
      },
    },
  });

  // 表が無いイベント。`Math.max(...[])` は -Infinity になるので先に返す。
  if (fresh.length === 0) return summary;

  const roundCount = Math.max(...fresh.map((m) => m.round));
  const slotIndex = new Map(fresh.map((m) => [`${m.round}:${m.bracketPosition}`, m]));

  for (const match of fresh) {
    const slot = nextSlot(match.round, match.bracketPosition, roundCount);
    if (!slot) continue; // 決勝

    const target = slotIndex.get(`${slot.round}:${slot.position}`);
    if (!target) continue;

    const targetSide = target.sides.find((s) => s.sideIndex === slot.sideIndex);
    if (!targetSide) continue;

    const winner =
      match.status === "VOID"
        ? null
        : (match.sides.find((s) => s.id === match.winnerSideId) ?? null);

    const desiredParticipants = winner ? winner.participants.map((p) => p.participantId) : [];
    const currentParticipants = targetSide.participants.map((p) => p.participantId);
    const desiredTeam = winner?.teamId ?? null;

    const sameParticipants =
      desiredParticipants.length === currentParticipants.length &&
      desiredParticipants.every((id) => currentParticipants.includes(id));
    const participantsChanged = !sameParticipants || targetSide.teamId !== desiredTeam;
    const targetIsBye = isByeRow(target.rules);

    if (participantsChanged) {
      // 次戦がすでに始まっている。ここで参加者を差し替えると、進行中の対戦の
      // 集計対象が途中で変わってしまうので触らない(主催者に警告を出す)。
      // ただし不戦勝行(targetIsBye)は検知が起きないので LIVE/DETECTED/NEEDS_REVIEW に
      // ならず、FINISHED も自動確定の結果でしかない — 常に上流の勝者へ追従させる。
      if (
        !targetIsBye &&
        isStartedMatch({
          status: target.status,
          winnerDecidedBy: target.winnerDecidedBy,
          isBye: targetIsBye,
        })
      ) {
        // ここは advanced に数えない。この枠は毎周「転送したい」状態のままなので、
        // 数えると finalizedAt が永久に立たなくなる。
        summary.blocked++;
        continue;
      }

      await tx.eventMatchSideParticipant.deleteMany({ where: { sideId: targetSide.id } });
      if (desiredParticipants.length > 0) {
        await tx.eventMatchSideParticipant.createMany({
          data: desiredParticipants.map((participantId) => ({
            sideId: targetSide.id,
            participantId,
          })),
        });
      }
      if (targetSide.teamId !== desiredTeam) {
        await tx.eventMatchSide.update({
          where: { id: targetSide.id },
          data: { teamId: desiredTeam },
        });
      }

      // **スナップショットを DB と同じ内容へ揃える。** この枠がさらに下流の feeder に
      // なっているとき、同じパスの後半でここを読む(上の doc を参照)。
      targetSide.participants = winner ? [...winner.participants] : [];
      targetSide.teamId = desiredTeam;

      summary.advanced++;
    }

    if (targetIsBye) {
      // 段階的不戦勝方式の不戦勝行。相手側は永久に空(BYE)なので、こちら側に
      // 勝者が来た時点でバトルを待たずに確定し、逆に上流が VOID 等で勝者を失ったら
      // 未確定へ戻す(自動で導出される状態なので、他の行のような「進行中は触らない」
      // 保護は不要 — 上のガードで進行中チェック自体を素通りさせている)。
      const shouldFinish = desiredParticipants.length > 0;
      const newStatus = shouldFinish ? "FINISHED" : "SCHEDULED";
      const newWinnerSideId = shouldFinish ? targetSide.id : null;
      const newDecidedBy = shouldFinish ? "BYE" : null;
      if (target.status !== newStatus || target.winnerSideId !== newWinnerSideId) {
        await tx.eventMatch.update({
          where: { id: target.id },
          data: { status: newStatus, winnerSideId: newWinnerSideId, winnerDecidedBy: newDecidedBy },
        });
        // ここもスナップショットへ反映する。**この不戦勝行を通過した勝者が、同じパスで
        // さらに下流へ進めるようにするため。** 段階的不戦勝方式では不戦勝が複数ラウンドに
        // わたるので、反映しないと1回の呼び出しで1段しか進まない。
        target.status = newStatus;
        target.winnerSideId = newWinnerSideId;
        target.winnerDecidedBy = newDecidedBy;
        summary.advanced++;
      }
    }
  }

  return summary;
}

type SideTotal = { sideId: string; diamonds: bigint; points: bigint };

/**
 * 検知区間のギフトをサイドごとに集計する。
 *
 * **開催日程の外にはみ出したぶんは数えない。** バトルは日程の終わりをまたぐことがあり
 * (22:59 開始 → 23:04 終了)、そのまま数えると「イベントの順位には入らないギフトが
 * 勝敗とデスマッチのライフには効く」という食い違いになる。
 */
async function scoreSides(
  tx: DbClient,
  params: {
    sides: SideRow[];
    start: Date;
    end: Date;
    windows: EventWindow[];
    multipliers: MultiplierInput[];
  }
): Promise<SideTotal[]> {
  const roomToSide = new Map<string, string>();
  for (const side of params.sides) {
    for (const p of side.participants) roomToSide.set(p.participant.roomId, side.id);
  }

  const totals = new Map<string, SideTotal>(
    params.sides.map((s) => [s.id, { sideId: s.id, diamonds: 0n, points: 0n }])
  );

  const roomIds = [...roomToSide.keys()];
  if (roomIds.length === 0) return [...totals.values()];

  // 検知区間の全体が「バトル中」。期間限定の倍率が区間内で切り替わることがあるので、
  // 区間そのものを buildRateSegments に通して倍率の変わり目で分ける。
  const spans = intersectWindows({ start: params.start, end: params.end }, params.windows);

  for (const span of spans) {
    const segments = buildRateSegments({
      eventStart: span.start,
      eventEnd: span.end,
      multipliers: params.multipliers,
      battleRanges: [span],
    });

    for (const segment of segments) {
      const rows = await aggregateGiftsBySegment(tx, {
        roomIds,
        start: segment.start,
        end: segment.end,
      });
      for (const row of rows) {
        const sideId = roomToSide.get(row.roomId);
        if (!sideId) continue;
        const total = totals.get(sideId);
        if (!total) continue;
        total.diamonds += row.diamonds;
        total.points += scaledPoints(row.diamonds, segment.scaledFactor);
      }
    }
  }

  return [...totals.values()];
}
