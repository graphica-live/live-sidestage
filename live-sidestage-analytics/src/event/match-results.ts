import { aggregateGiftsBySegment, type DbClient } from "./analytics-db";
import { nextSlot } from "./bracket";
import { MANUAL_DECISIONS } from "./match-detect";
import { isByeRow, isStartedMatch } from "./match-status";
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
   * **`aggregate.ts` はこれが 0 でない周回で `finalizedAt` を立てない。** 検知と進行は
   * 1周につき1ラウンドしか進まないので、締切後に表を作り直すと「1回戦を確定して
   * 2回戦へ送った周回でそのまま最終集計になり、2回戦以降が永久に SCHEDULED」になる。
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

/**
 * 検知が終わったマッチのスコアを確定し、勝者を決め、トーナメント表を進める。
 *
 * 集計トランザクションの中から呼ぶ。
 */
export async function resolveMatchResults(
  tx: DbClient,
  params: {
    eventId: string;
    multipliers: MultiplierInput[];
    /** 開催日程。検知区間がここからはみ出したぶんは勝敗に数えない */
    windows: EventWindow[];
    now: Date;
  }
): Promise<MatchResultSummary> {
  const matches = await tx.eventMatch.findMany({
    where: { eventId: params.eventId },
    orderBy: [{ round: "asc" }, { bracketPosition: "asc" }],
    select: {
      id: true,
      round: true,
      bracketPosition: true,
      status: true,
      detectedStartAt: true,
      detectedEndAt: true,
      winnerSideId: true,
      winnerDecidedBy: true,
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

  if (matches.length === 0) return { finished: 0, tied: 0, blocked: 0, advanced: 0 };

  const summary: MatchResultSummary = { finished: 0, tied: 0, blocked: 0, advanced: 0 };

  // ------------------------------------------------------------------
  // 1. スコアの確定と勝者の決定
  // ------------------------------------------------------------------
  for (const match of matches) {
    if (match.winnerDecidedBy && MANUAL_DECISIONS.has(match.winnerDecidedBy)) continue;
    if (match.status === "VOID") continue;
    if (!match.detectedStartAt || !match.detectedEndAt) continue;
    // 進行中と承認待ちは確定させない。
    if (match.status !== "DETECTED" && match.status !== "FINISHED") continue;
    if (match.detectedEndAt > params.now) continue;

    const totals = await scoreSides(tx, {
      sides: match.sides as SideRow[],
      start: match.detectedStartAt,
      end: match.detectedEndAt,
      windows: params.windows,
      multipliers: params.multipliers,
    });

    for (const t of totals) {
      await tx.eventMatchSide.update({
        where: { id: t.sideId },
        data: { diamonds: t.diamonds, score: formatScaledPoints(t.points) },
      });
    }

    // 勝敗は倍率適用前のダイヤで決める。倍率は個人の通算ポイント用のもので、
    // 対戦の勝敗に効かせると同じ実績でも枠の取り方で結果が変わってしまう。
    const best = totals.reduce((a, b) => (b.diamonds > a.diamonds ? b : a), totals[0]);
    const tie = totals.filter((t) => t.diamonds === best.diamonds).length > 1;

    if (tie || best.diamonds === 0n) {
      // 同点(0対0を含む)は自動で決めない。主催者が手動で確定する。
      summary.tied++;
      if (match.winnerSideId) {
        await tx.eventMatch.update({
          where: { id: match.id },
          data: { winnerSideId: null, winnerDecidedBy: null, status: "DETECTED" },
        });
      }
      continue;
    }

    await tx.eventMatch.update({
      where: { id: match.id },
      data: { winnerSideId: best.sideId, winnerDecidedBy: "AGGREGATE", status: "FINISHED" },
    });
    summary.finished++;
  }

  // ------------------------------------------------------------------
  // 2. トーナメント表の進行(毎回作り直す)
  // ------------------------------------------------------------------
  const fresh = await tx.eventMatch.findMany({
    where: { eventId: params.eventId },
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
      if (target.status !== newStatus || target.winnerSideId !== newWinnerSideId) {
        await tx.eventMatch.update({
          where: { id: target.id },
          data: { status: newStatus, winnerSideId: newWinnerSideId, winnerDecidedBy: shouldFinish ? "BYE" : null },
        });
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
