import { NextRequest, NextResponse } from "next/server";
import { requireEventOwner } from "@/event/authz";
import { prisma } from "@/lib/prisma";
import { parseJstLocal } from "@/event/datetime";
import { nextSlot } from "@/event/bracket";
import { acquireEventLock } from "@/event/event-lock";
import { isByeRow, isStartedMatch } from "@/event/match-status";
import {
  isTransactionTimeout,
  MUTATION_TX_OPTIONS,
  reopenAggregation,
} from "@/event/reopen-aggregation";
import { assertMatchWindow, SingleMatchError } from "@/event/single-match";
import type { DbClient } from "@/event/analytics-db";

/** 結果を変えるトランザクション。集計とのロック待ちがあるので既定より長く待つ。 */
function inTx<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, MUTATION_TX_OPTIONS);
}

// 主催者による対戦の手当て。
//
// バトルの自動検知は payload の解釈と両サイドの監視が揃って初めて働くので、
// **検知が失敗しても主催者が手で進められる導線を必ず用意する。**
//
// **結果を変える操作は必ず reopenAggregation を同じトランザクションで呼ぶ。**
// 集計ワーカーは finalizedAt が立ったイベントを飛ばすので、消さないと変更が反映されない。
//
// **状態の読み取りと判定は、すべて acquireEventLock を取った後のトランザクション内で行う。**
// 外で読んで中で書くと、10秒ごとに status を書き換える集計ワーカーや、表を丸ごと
// 作り直す `POST /matches` と競合したときに、古い値で通した判定がそのままコミットされる。
// ロックを先に取る順序は破棄側(tournament.ts)と揃っていないとデッドロックする
// (あちらは「ロック → 行削除」、こちらが「行更新 → ロック」だと逆順になる)。

/** 時間枠を動かせる状態。検知・確定した後は動かさせない(下の理由を参照)。 */
const RESCHEDULABLE = new Set(["SCHEDULED", "NO_SHOW"]);

type Action = "approve" | "confirm" | "draw" | "void" | "reopen" | "schedule";

/** ロック内の検証で弾いたときの応答。トランザクションからはこれを返して外で JSON にする。 */
type Failure = { error: string; code?: string; status: number };

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; matchId: string } }
) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    action?: unknown;
    winnerSideId?: unknown;
    scheduledStartAt?: unknown;
    scheduledEndAt?: unknown;
  } | null;

  const action = body?.action as Action | undefined;
  if (!action) {
    return NextResponse.json({ error: "action を指定してください。" }, { status: 400 });
  }

  // 時刻のパースだけは DB を要らないので先に済ませる(不正な入力でロックを取らない)。
  const start =
    typeof body?.scheduledStartAt === "string" ? parseJstLocal(body.scheduledStartAt) : null;
  const end =
    typeof body?.scheduledEndAt === "string" ? parseJstLocal(body.scheduledEndAt) : null;
  if (action === "schedule" && (!start || !end || start >= end)) {
    return NextResponse.json(
      { error: "開始日時と、それより後の終了日時を入力してください。" },
      { status: 400 }
    );
  }

  let failure: Failure | null = null;
  try {
    failure = await inTx(async (tx): Promise<Failure | null> => {
      // **ここから先の読み取りはすべてロックの内側。** 順序は破棄側と揃える。
      await acquireEventLock(tx, params.id);

      const match = await tx.eventMatch.findFirst({
        where: { id: params.matchId, eventId: params.id },
        select: {
          id: true,
          round: true,
          bracketPosition: true,
          status: true,
          winnerSideId: true,
          rules: true,
          sides: { select: { id: true, sideIndex: true } },
        },
      });
      if (!match) return { error: "Not found", status: 404 };

      const resultAction =
        action === "confirm" || action === "draw" || action === "void" || action === "reopen";

      // 不戦勝行は主催者が結果を操作する対象ではない(対戦が起きていないので勝者確定・
      // 引き分け・無効化・検知やり直しのいずれも意味を持たない)。段階的不戦勝方式では
      // 相手側が永久に空なので、放置すると検知対象化(部外者との対戦を誤って拾う)や
      // NO_SHOW 化のリスクがある。勝者は match-results.ts の進行処理が自動で決める。
      if (isByeRow(match.rules) && resultAction) {
        return { error: "不戦勝の対戦は結果を変更できません。", code: "BYE_ROW", status: 400 };
      }

      // 勝敗を動かす操作は、次の対戦が始まっていたら拒否する。
      // 進行中の対戦の参加者が途中で入れ替わると、集計対象が変わって結果が壊れるため。
      if (resultAction && (await downstreamStarted(tx, params.id, match.round, match.bracketPosition))) {
        return {
          error: "次の対戦がすでに始まっているため、この対戦の結果は変更できません。",
          code: "DOWNSTREAM_STARTED",
          status: 409,
        };
      }

      switch (action) {
        case "approve": {
          // 部分一致や 2vs2 の検知を主催者が認める。勝敗は次の集計で決まる。
          if (match.status !== "NEEDS_REVIEW") {
            return { error: "承認待ちの対戦ではありません。", status: 400 };
          }
          await tx.eventMatch.update({
            where: { id: match.id },
            data: { status: "DETECTED" },
          });
          break;
        }

        case "confirm": {
          const winnerSideId = typeof body?.winnerSideId === "string" ? body.winnerSideId : null;
          if (!winnerSideId || !match.sides.some((s) => s.id === winnerSideId)) {
            return { error: "この対戦のサイドを勝者に指定してください。", status: 400 };
          }
          await tx.eventMatch.update({
            where: { id: match.id },
            data: { status: "FINISHED", winnerSideId, winnerDecidedBy: "MANUAL" },
          });
          break;
        }

        case "draw": {
          // 引き分けで確定する。デスマッチでは両者のライフが drawDelta だけ減る。
          // トーナメントでは勝者が出ないと次へ進めないので使わせない。
          const event = await tx.event.findUnique({
            where: { id: params.id },
            select: { format: true },
          });
          if (event?.format !== "DEATHMATCH") {
            return { error: "引き分けで確定できるのはデスマッチだけです。", status: 400 };
          }
          await tx.eventMatch.update({
            where: { id: match.id },
            data: { status: "FINISHED", winnerSideId: null, winnerDecidedBy: "DRAW" },
          });
          break;
        }

        case "void": {
          await tx.eventMatch.update({
            where: { id: match.id },
            data: { status: "VOID", winnerSideId: null, winnerDecidedBy: null },
          });
          // 集計済みのスコアも消す。無効にした対戦の数字が残っていると
          // 「もう結果が出ている」と読めてしまう。
          await tx.eventMatchSide.updateMany({
            where: { matchId: match.id },
            data: { diamonds: 0, score: 0 },
          });
          break;
        }

        case "reopen": {
          // 検知のやり直し。自動検知の対象へ戻す。
          await tx.eventMatch.update({
            where: { id: match.id },
            data: {
              status: "SCHEDULED",
              winnerSideId: null,
              winnerDecidedBy: null,
              detectedBattleId: null,
              detectedStartAt: null,
              detectedEndAt: null,
              detectionConfidence: null,
              detectedEndSource: null,
            },
          });
          await tx.eventMatchSide.updateMany({
            where: { matchId: match.id },
            data: { diamonds: 0, score: 0 },
          });
          break;
        }

        case "schedule": {
          // **検知・確定した後は時間枠を動かせない。**
          // デスマッチのライフは決着時刻の順に適用し、その時刻は
          // `detectedEndAt ?? scheduledEndAt` なので、確定後に枠を動かすと
          // 過去の対戦順が変わって脱落の結果まで変わってしまう。
          // 動かしたい場合は先に「検知をやり直す」で SCHEDULED へ戻す。
          if (!RESCHEDULABLE.has(match.status)) {
            return {
              error:
                "検知・確定した対戦の時間枠は変更できません。先に検知をやり直してください。",
              code: "NOT_RESCHEDULABLE",
              status: 409,
            };
          }
          // 追加時と同じ検証を通す(開催日程の中・同じ出場者の枠が重ならない)。
          // 日程を読むのもロックの内側なので、日程の変更と同時に走っても
          // 古い日程で通した枠が外に取り残されることはない。
          await assertMatchWindow(tx, {
            eventId: params.id,
            start: start!,
            end: end!,
            excludeMatchId: match.id,
          });
          await tx.eventMatch.update({
            where: { id: match.id },
            data: { scheduledStartAt: start!, scheduledEndAt: end! },
          });
          break;
        }

        default:
          return { error: "未知の action です。", status: 400 };
      }

      await reopenAggregation(tx, params.id);
      return null;
    });
  } catch (err) {
    if (err instanceof SingleMatchError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "OVERLAPPING" ? 409 : 400 }
      );
    }
    if (isTransactionTimeout(err)) return eventBusy();
    throw err;
  }

  if (failure) {
    return NextResponse.json(
      { error: failure.error, ...(failure.code ? { code: failure.code } : {}) },
      { status: failure.status }
    );
  }
  return NextResponse.json({ ok: true });
}

/** 集計とのロック待ちで打ち切られたときの応答。主催者にやり直させる。 */
function eventBusy() {
  return NextResponse.json(
    {
      error: "集計中で混み合っています。少し待ってからやり直してください。",
      code: "EVENT_BUSY",
    },
    { status: 503 }
  );
}

/**
 * 対戦カードを取り消す。まだ検知していない(SCHEDULED)ものだけ。
 *
 * トーナメントの表は枠が繋がっているので個別削除させない。デスマッチ用。
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; matchId: string } }
) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let failure: Failure | null = null;
  try {
    failure = await inTx(async (tx): Promise<Failure | null> => {
      await acquireEventLock(tx, params.id);

      const event = await tx.event.findUnique({
        where: { id: params.id },
        select: { format: true },
      });
      if (event?.format !== "DEATHMATCH") {
        return {
          error: "対戦を個別に削除できるのはデスマッチだけです。無効にしてください。",
          status: 400,
        };
      }

      const match = await tx.eventMatch.findFirst({
        where: { id: params.matchId, eventId: params.id },
        select: { id: true, status: true },
      });
      if (!match) return { error: "Not found", status: 404 };
      if (match.status !== "SCHEDULED") {
        return {
          error: "すでに検知・確定した対戦は削除できません。無効にしてください。",
          code: "ALREADY_STARTED",
          status: 409,
        };
      }

      await tx.eventMatch.delete({ where: { id: match.id } });
      await reopenAggregation(tx, params.id);
      return null;
    });
  } catch (err) {
    if (isTransactionTimeout(err)) return eventBusy();
    throw err;
  }

  if (failure) {
    return NextResponse.json(
      { error: failure.error, ...(failure.code ? { code: failure.code } : {}) },
      { status: failure.status }
    );
  }
  return NextResponse.json({ ok: true });
}

async function downstreamStarted(
  tx: DbClient,
  eventId: string,
  round: number,
  position: number
): Promise<boolean> {
  const agg = await tx.eventMatch.aggregate({
    where: { eventId },
    _max: { round: true },
  });
  const roundCount = agg._max.round ?? round;

  // 不戦勝行は自動通過にすぎないので、それ自体が FINISHED でも「進行が始まった」とは
  // 数えない。透過してさらに下流を見る(段階的不戦勝方式は不戦勝行が複数ラウンドに
  // わたることがある)。ラウンド数で有界なので無限ループにはならない。
  let cur = { round, position };
  for (let hop = 0; hop < roundCount; hop++) {
    const slot = nextSlot(cur.round, cur.position, roundCount);
    if (!slot) return false;

    const next = await tx.eventMatch.findFirst({
      where: { eventId, round: slot.round, bracketPosition: slot.position },
      select: { status: true, winnerDecidedBy: true, rules: true },
    });
    if (!next) return false;

    const nextIsBye = isByeRow(next.rules);
    if (nextIsBye) {
      cur = { round: slot.round, position: slot.position };
      continue;
    }
    return isStartedMatch({
      status: next.status,
      winnerDecidedBy: next.winnerDecidedBy,
      isBye: nextIsBye,
    });
  }
  return false;
}
