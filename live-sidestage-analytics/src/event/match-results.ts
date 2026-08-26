import { aggregateGiftsBySegment, type DbClient } from "./analytics-db";
import { nextSlot } from "./bracket";
import { MANUAL_DECISIONS } from "./match-detect";
import { isByeRow, isStartedMatch, parseLoserFrom } from "./match-status";
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
      // 日程が付いていない対戦(移行前のデータ)だけ、従来どおり全日程と交差させる。
      windows: match.session
        ? [
            {
              id: null,
              start: match.session.startAt,
              end: match.session.endAt,
              name: match.session.name,
            },
          ]
        : params.windows,
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
  // 2. トーナメント表の進行
  // ------------------------------------------------------------------
  const advance = await advanceBracket(tx, params.eventId);
  summary.blocked += advance.blocked;
  summary.advanced += advance.advanced;

  return summary;
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

    // 勝者辺。`nextSlot()` の座標だけで決まる（順位決定戦ブロックも同じ座標空間なので
    // ブロック内の進行はここで一緒に処理される）。
    const slot = nextSlot(match.round, match.bracketPosition, roundCount);
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
