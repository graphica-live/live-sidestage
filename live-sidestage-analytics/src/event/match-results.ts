import type { Prisma } from "@prisma/client";
import { aggregateGiftsBySegment, type DbClient } from "./analytics-db";
import { groupByCombinedGroup, sortCandidatesDeterministically } from "./candidate-groups";
import { MANUAL_DECISIONS } from "./match-detect";
import {
  isByeRow,
  isCandidatesConfirmedByOrganizer,
  isStartedMatch,
  mergeReviewReason,
  parseLoserFrom,
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
import { buildWinnerFeederGraph, targetOf, BracketInconsistentError } from "./winner-feeders";

export { BracketInconsistentError };

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

export type SideRow = {
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
  combinedGroupId: string | null;
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
          combinedGroupId: true,
        },
      },
    },
  })) as MatchWithCandidates[];

  if (matches.length === 0) return { finished: 0, tied: 0, blocked: 0, advanced: 0 };

  const summary: MatchResultSummary = { finished: 0, tied: 0, blocked: 0, advanced: 0 };

  // 下流(次ラウンド)が着手済みかの判定に使う。advanceBracket と同じ座標系。
  const roundCount = Math.max(...matches.map((m) => m.round));
  const slotIndex = new Map(matches.map((m) => [`${m.round}:${m.bracketPosition}`, m]));

  // **勝者辺は座標既定(`nextSlot`)ではなく `WinnerFeederGraph` を通す。** 接続の交換
  // (`winnerFeeders`)で上書きされている枠を座標から読むと、別の対戦を下流と誤認して
  // 差し戻しを誤ブロック/素通りさせる(`src/event/CLAUDE.md` の「勝者辺を座標から読む箇所は
  // 3つに閉じている」)。壊れたoverrideは fail closed で止める。
  const seriesFeederGraph = buildWinnerFeederGraph(
    matches.map((m) => ({ round: m.round, bracketPosition: m.bracketPosition, rules: m.rules })),
    roundCount
  );
  if (!seriesFeederGraph.ok) throw new BracketInconsistentError();
  const seriesGraph = seriesFeederGraph.graph;

  // ------------------------------------------------------------------
  // 1. 候補バトルから勝敗を確定する(resolveMatchSeries に一本化)
  // ------------------------------------------------------------------
  for (const match of matches) {
    if (match.winnerDecidedBy && MANUAL_DECISIONS.has(match.winnerDecidedBy)) continue;
    if (match.status === "VOID" || match.status === "NO_SHOW") continue;
    // 対象は「候補が1件以上あるか、上の除外に当てはまらないマッチ全部」
    // (候補が0件でも SCHEDULED へ戻す後始末を resolveMatchSeries 側で行うため対象に含める)。

    const slot = targetOf(seriesGraph, match.round, match.bracketPosition);
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

  // **グルーピングは「未来終了フィルタより前」に行う。** 先に resolved へ絞ってから
  // グループ化すると、グループ内の1メンバーだけ未来終了(duration由来のLIVE)のときに
  // そのメンバーだけ静かに脱落し、グループが「完了済みメンバーだけの偽の1件グループ」
  // として確定してしまう。pool は startedAt 昇順の保証がない(呼び出し元の select 順に
  // 依存する既存の前提)ので、決定的な順序に揃えてからグループ化する。
  const orderedPool = sortCandidatesDeterministically(pool);
  const groupedPool: CandidateRow[][] = groupByCombinedGroup(orderedPool);

  // **終了時刻が確定していても、その時刻がまだ未来なら「進行中」として扱う。**
  // duration から終了時刻を計算した OPEN 状態のバトル(旧 detectMatches の
  // `a.endedAt > params.now` 判定を踏襲)。ここで resolved に含めて採点してしまうと、
  // まだ終わっていないバトルの結果を先取りして確定させてしまう。
  // **グループ全体が確定しているかで判定する。** 1件でも endedAt===null または
  // endedAt>now のメンバーがいれば、そのグループ全体を pending 扱いにする
  // (グループの一部だけを確定させない)。
  const isGroupResolved = (g: CandidateRow[]) => g.every((c) => c.endedAt !== null && c.endedAt <= now);
  const resolvedGroups = groupedPool.filter(isGroupResolved);
  const pendingGroups = groupedPool.filter((g) => !isGroupResolved(g));
  const resolved = resolvedGroups.flat();
  const pending = pendingGroups.flat();

  // 7. 候補数超過(主催者確定前だけ判定する)。**「候補」ではなく「グループ」の個数で
  //    判定する。** combinedGroupId が全部 null の既存データでは groupedPool は
  //    「候補1件=グループ1件」になるため resolvedGroups.length === resolved.length と
  //    完全に一致し、既存の振る舞い・既存integrationテストと後方互換。
  if (!organizerCurated && resolvedGroups.length > maxGames) {
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

  // 9. 実効ゲーム集合(effectiveGames)を計算する。**「1候補グループ=1ゲーム」**
  //    (combinedGroupId が同じ隣接候補は合算して1ゲームとして扱う。通常は1候補=1グループ)。
  //    **毎回 scoreSides() で採点する**(キャッシュしない)。どちらかが winsNeeded に
  //    達した時点で打ち切り、それ以降の resolvedGroups は無視する(誤って多すぎる候補が
  //    紛れても決着時刻がずれないため)。
  const sideTotals = new Map<string, { diamonds: bigint; points: bigint }>(
    match.sides.map((s) => [s.id, { diamonds: 0n, points: 0n }])
  );
  const sideWins = new Map<string, number>();
  const effectiveGames: CandidateRow[][] = [];
  let decidedWinnerSideId: string | null = null;

  for (const group of resolvedGroups) {
    const groupTotals = new Map<string, { diamonds: bigint; points: bigint }>(
      match.sides.map((s) => [s.id, { diamonds: 0n, points: 0n }])
    );

    for (const candidate of group) {
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

      for (const t of totals) {
        const acc = groupTotals.get(t.sideId);
        if (!acc) continue;
        acc.diamonds += t.diamonds;
        acc.points += t.points;
      }
    }

    effectiveGames.push(group);
    for (const [sideId, totals] of groupTotals) {
      const acc = sideTotals.get(sideId);
      if (!acc) continue;
      acc.diamonds += totals.diamonds;
      acc.points += totals.points;
    }

    // ゲーム(合算後)の勝者は倍率適用前の合算ダイヤで決める(match-results.ts 冒頭のコメント参照)。
    const gameWinnerSideId = resolveGameWinner(
      [...groupTotals.entries()].map(([sideId, t]) => ({ sideId, diamonds: t.diamonds }))
    );

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
  const effectiveIds = new Set(effectiveGames.flatMap((group) => group.map((c) => c.id)));
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
    // 11. 決着した。firstGame は最初のグループの最初の候補(startedAt最小)。lastGame は
    // 最後のグループの最後のメンバー(startedAt昇順で最後 = 決定事項3「グループ内で最後に
    // 終了した候補」— 同じ対戦の候補どうしは時間的に重ならないため、startedAt昇順の末尾は
    // 常に endedAt も最大になる)。
    const firstGame = effectiveGames[0][0];
    const lastGroup = effectiveGames[effectiveGames.length - 1];
    const lastGame = lastGroup[lastGroup.length - 1];
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
  if (pendingGroups.length > 0) {
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

  return { decided: false, tied: pendingGroups.length === 0 && effectiveGames.length > 0 };
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

  // 勝者辺の解決マップ。`winnerFeeders` override があればそちらを、無ければ `nextSlot()` の
  // 既定座標を使う(`winner-feeders.ts` 参照)。壊れていたら fail closed で止める。
  const feederGraph = buildWinnerFeederGraph(
    fresh.map((m) => ({ round: m.round, bracketPosition: m.bracketPosition, rules: m.rules })),
    roundCount
  );
  if (!feederGraph.ok) throw new BracketInconsistentError();
  const graph = feederGraph.graph;

  type FreshMatch = (typeof fresh)[number];
  type Transfer = {
    target: FreshMatch;
    targetSide: FreshMatch["sides"][number];
    /** null は「上流がまだ決まっていない / VOID になった」= 枠を空へ戻す */
    source: SideRow | null;
    desiredParticipants: string[];
    desiredTeam: string | null;
    /** 転送先の中身が今と違うか。false なら書き込む必要がない */
    changed: boolean;
    isBye: boolean;
  };

  /** 転送の中身を先に決める。**書き込みはしない**(all-or-nothing の判定に要る)。 */
  const planTransfer = (
    target: FreshMatch,
    targetSide: FreshMatch["sides"][number],
    source: SideRow | null
  ): Transfer => {
    const desiredParticipants = source ? source.participants.map((p) => p.participantId) : [];
    const currentParticipants = targetSide.participants.map((p) => p.participantId);
    const desiredTeam = source?.teamId ?? null;

    const sameParticipants =
      desiredParticipants.length === currentParticipants.length &&
      desiredParticipants.every((id) => currentParticipants.includes(id));

    return {
      target,
      targetSide,
      source,
      desiredParticipants,
      desiredTeam,
      changed: !sameParticipants || targetSide.teamId !== desiredTeam,
      isBye: isByeRow(target.rules),
    };
  };

  /**
   * 次戦がすでに始まっている枠か。ここで参加者を差し替えると、進行中の対戦の
   * 集計対象が途中で変わってしまう。
   *
   * ただし不戦勝行は検知が起きないので LIVE/DETECTED/NEEDS_REVIEW にならず、
   * FINISHED も自動確定の結果でしかない — 常に上流へ追従させる。
   */
  const isBlocked = (transfer: Transfer): boolean =>
    transfer.changed &&
    !transfer.isBye &&
    isStartedMatch({
      status: transfer.target.status,
      winnerDecidedBy: transfer.target.winnerDecidedBy,
      isBye: transfer.isBye,
    });

  const applyTransfer = async (transfer: Transfer) => {
    const { target, targetSide, desiredParticipants, desiredTeam } = transfer;

    if (transfer.changed) {
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
      targetSide.participants = transfer.source ? [...transfer.source.participants] : [];
      targetSide.teamId = desiredTeam;

      summary.advanced++;
    }

    if (transfer.isBye) {
      // 不戦勝行。相手側は永久に空(BYE)なので、こちら側に出場者が来た時点で
      // バトルを待たずに確定し、逆に上流が VOID 等で出場者を失ったら未確定へ戻す
      // (自動で導出される状態なので、他の行のような「進行中は触らない」保護は不要)。
      // 段階的不戦勝方式の本選と、順位決定戦ブロックの葉の両方がここを通る。
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
  };

  // 敗者辺の逆引き。**座標からは導出できない**ので、順位決定戦の行が持つ
  // `rules.loserFrom`（どの本選の行の敗者が来るか）から引く。
  const loserTargets = new Map<string, { target: FreshMatch; sideIndex: number }[]>();
  for (const match of fresh) {
    const loserFrom = parseLoserFrom(match.rules);
    if (!loserFrom) continue;
    loserFrom.forEach((slot, sideIndex) => {
      if (!slot) return;
      const key = `${slot.round}:${slot.position}`;
      const list = loserTargets.get(key);
      if (list) list.push({ target: match, sideIndex });
      else loserTargets.set(key, [{ target: match, sideIndex }]);
    });
  }

  for (const match of fresh) {
    const transfers: Transfer[] = [];

    // 勝者辺。既定は `nextSlot()` の座標(順位決定戦ブロックも同じ座標空間なので
    // ブロック内の進行はここで一緒に処理される)、`winnerFeeders` override があればそちら。
    const slot = targetOf(graph, match.round, match.bracketPosition);
    if (slot) {
      const target = slotIndex.get(`${slot.round}:${slot.position}`);
      const targetSide = target?.sides.find((s) => s.sideIndex === slot.sideIndex);
      if (target && targetSide) {
        const winner =
          match.status === "VOID"
            ? null
            : (match.sides.find((s) => s.id === match.winnerSideId) ?? null);
        transfers.push(planTransfer(target, targetSide, winner));
      }
    }

    // 敗者辺（順位決定戦の葉へ）。
    const losing = loserTargets.get(`${match.round}:${match.bracketPosition}`);
    if (losing) {
      const loser = resolveLoser(match);
      for (const { target, sideIndex } of losing) {
        const targetSide = target.sides.find((s) => s.sideIndex === sideIndex);
        if (targetSide) transfers.push(planTransfer(target, targetSide, loser));
      }
    }

    if (transfers.length === 0) continue;

    // **1つでも弾かれるなら、この上流からの転送は全部やらない。**
    // 辺ごとに判定すると、勝敗が覆ったときに「決勝は始まっているので旧勝者のまま、
    // 3位決定戦は未開始なので新しい敗者を受け取る」となり、**同じ参加者が決勝と
    // 3位決定戦の両方に載る**。表として破綻しているので、片方だけ進めるより
    // 両方を古いまま揃えて主催者に警告を出すほうがよい。
    if (transfers.some(isBlocked)) {
      // ここは advanced に数えない。この枠は毎周「転送したい」状態のままなので、
      // 数えると finalizedAt が永久に立たなくなる。
      summary.blocked++;
      continue;
    }

    for (const transfer of transfers) await applyTransfer(transfer);
  }

  return summary;
}

/**
 * 順位決定戦へ送る敗者のサイド。**敗者が存在しないケースを漏らさないこと。**
 *
 * - `VOID` / 未確定 — まだ誰も負けていない
 * - `BYE` — 対戦そのものが起きていないので敗者はいない（相手側は永久に空）
 * - `DRAW` — 引き分けに敗者はいない（トーナメントでは `[matchId]` API が拒否するが、
 *   デスマッチから種目を切り替えた等で残りうるので fail closed にしておく）
 */
function resolveLoser(match: {
  status: string;
  winnerSideId: string | null;
  winnerDecidedBy: string | null;
  rules: unknown;
  sides: SideRow[];
}): SideRow | null {
  if (match.status !== "FINISHED" || !match.winnerSideId) return null;
  if (match.winnerDecidedBy === "BYE" || match.winnerDecidedBy === "DRAW") return null;
  if (isByeRow(match.rules)) return null;
  return match.sides.find((s) => s.id !== match.winnerSideId) ?? null;
}

export type SideTotal = { sideId: string; diamonds: bigint; points: bigint };

/**
 * サイド別のダイヤ合計から、1ゲームの勝者を決める。**倍率適用前のダイヤで決める**
 * (`points` は無視する)。同点、または全サイド0なら勝者なし(null)。
 *
 * 対戦カード1件分の決着判定(このファイル内)だけでなく、対戦詳細ページのバトル単位の
 * 内訳表示(`match-detail.ts`)からも呼ぶ純粋関数。決着判定と表示側で勝者の定義が
 * ずれると閲覧者の見る「勝敗」と実際の決着が食い違うため、ロジックをここに一本化する。
 */
export function resolveGameWinner(totals: { sideId: string; diamonds: bigint }[]): string | null {
  if (totals.length === 0) return null;
  const best = totals.reduce((a, b) => (b.diamonds > a.diamonds ? b : a), totals[0]);
  const tie = totals.filter((t) => t.diamonds === best.diamonds).length > 1;
  return tie || best.diamonds === 0n ? null : best.sideId;
}

/**
 * 検知区間のギフトをサイドごとに集計する。
 *
 * **開催日程の外にはみ出したぶんは数えない。** バトルは日程の終わりをまたぐことがあり
 * (22:59 開始 → 23:04 終了)、そのまま数えると「イベントの順位には入らないギフトが
 * 勝敗とデスマッチのライフには効く」という食い違いになる。
 *
 * **候補ごとの低ダイヤ集計API(`candidate-diamonds/route.ts`)からも呼ぶ。** 表示専用の
 * 生ダイヤ判定に、勝敗確定と同じ「日程で切ってから集計する」ロジックを再利用するため
 * (`multipliers: []` を渡せば倍率をかけず生ダイヤのまま返る)。
 */
export async function scoreSides(
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
