import { NextRequest, NextResponse } from "next/server";
import { requireEventOwner } from "@/event/authz";
import { prisma } from "@/lib/prisma";
import { parseJstLocal } from "@/event/datetime";
import { nextSlot } from "@/event/bracket";
import { acquireEventLock } from "@/event/event-lock";
import { MUTATION_TX_OPTIONS, reopenAggregation } from "@/event/reopen-aggregation";
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

/** 下流の対戦がこの状態に入っていたら、上流の勝敗は動かさせない。 */
const DOWNSTREAM_STARTED = new Set(["LIVE", "DETECTED", "NEEDS_REVIEW", "FINISHED"]);

/** 時間枠を動かせる状態。検知・確定した後は動かさせない(下の理由を参照)。 */
const RESCHEDULABLE = new Set(["SCHEDULED", "NO_SHOW"]);

type Action = "approve" | "confirm" | "draw" | "void" | "reopen" | "schedule";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; matchId: string } }
) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const match = await prisma.eventMatch.findFirst({
    where: { id: params.matchId, eventId: params.id },
    select: {
      id: true,
      round: true,
      bracketPosition: true,
      status: true,
      winnerSideId: true,
      sides: { select: { id: true, sideIndex: true } },
    },
  });
  if (!match) {
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

  // 勝敗を動かす操作は、次の対戦が始まっていたら拒否する。
  // 進行中の対戦の参加者が途中で入れ替わると、集計対象が変わって結果が壊れるため。
  if (action === "confirm" || action === "draw" || action === "void" || action === "reopen") {
    const blocked = await downstreamStarted(params.id, match.round, match.bracketPosition);
    if (blocked) {
      return NextResponse.json(
        {
          error: "次の対戦がすでに始まっているため、この対戦の結果は変更できません。",
          code: "DOWNSTREAM_STARTED",
        },
        { status: 409 }
      );
    }
  }

  switch (action) {
    case "approve": {
      // 部分一致や 2vs2 の検知を主催者が認める。勝敗は次の集計で決まる。
      if (match.status !== "NEEDS_REVIEW") {
        return NextResponse.json(
          { error: "承認待ちの対戦ではありません。" },
          { status: 400 }
        );
      }
      await inTx(async (tx) => {
        await tx.eventMatch.update({
          where: { id: match.id },
          data: { status: "DETECTED" },
        });
        await reopenAggregation(tx, params.id);
      });
      break;
    }

    case "confirm": {
      const winnerSideId = typeof body?.winnerSideId === "string" ? body.winnerSideId : null;
      if (!winnerSideId || !match.sides.some((s) => s.id === winnerSideId)) {
        return NextResponse.json(
          { error: "この対戦のサイドを勝者に指定してください。" },
          { status: 400 }
        );
      }
      await inTx(async (tx) => {
        await tx.eventMatch.update({
          where: { id: match.id },
          data: { status: "FINISHED", winnerSideId, winnerDecidedBy: "MANUAL" },
        });
        await reopenAggregation(tx, params.id);
      });
      break;
    }

    case "draw": {
      // 引き分けで確定する。デスマッチでは両者のライフが drawDelta だけ減る。
      // トーナメントでは勝者が出ないと次へ進めないので使わせない。
      const event = await prisma.event.findUnique({
        where: { id: params.id },
        select: { format: true },
      });
      if (event?.format !== "DEATHMATCH") {
        return NextResponse.json(
          { error: "引き分けで確定できるのはデスマッチだけです。" },
          { status: 400 }
        );
      }
      await inTx(async (tx) => {
        await tx.eventMatch.update({
          where: { id: match.id },
          data: { status: "FINISHED", winnerSideId: null, winnerDecidedBy: "DRAW" },
        });
        await reopenAggregation(tx, params.id);
      });
      break;
    }

    case "void": {
      await inTx(async (tx) => {
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
        await reopenAggregation(tx, params.id);
      });
      break;
    }

    case "reopen": {
      // 検知のやり直し。自動検知の対象へ戻す。
      await inTx(async (tx) => {
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
        await reopenAggregation(tx, params.id);
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
        return NextResponse.json(
          {
            error:
              "検知・確定した対戦の時間枠は変更できません。先に検知をやり直してください。",
            code: "NOT_RESCHEDULABLE",
          },
          { status: 409 }
        );
      }

      const start =
        typeof body?.scheduledStartAt === "string" ? parseJstLocal(body.scheduledStartAt) : null;
      const end =
        typeof body?.scheduledEndAt === "string" ? parseJstLocal(body.scheduledEndAt) : null;
      if (!start || !end || start >= end) {
        return NextResponse.json(
          { error: "開始日時と、それより後の終了日時を入力してください。" },
          { status: 400 }
        );
      }

      try {
        // 追加時と同じ検証を通す(開催日程の中・同じ出場者の枠が重ならない)。
        await inTx(async (tx) => {
          // **日程を読む前にロックを取る。** 日程の変更と同時だと、古い日程で
          // 通した枠が日程の外に取り残される。
          await acquireEventLock(tx, params.id);
          await assertMatchWindow(tx, {
            eventId: params.id,
            start,
            end,
            excludeMatchId: match.id,
          });
          await tx.eventMatch.update({
            where: { id: match.id },
            data: { scheduledStartAt: start, scheduledEndAt: end },
          });
          await reopenAggregation(tx, params.id);
        });
      } catch (err) {
        if (err instanceof SingleMatchError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: err.code === "OVERLAPPING" ? 409 : 400 }
          );
        }
        throw err;
      }
      break;
    }

    default:
      return NextResponse.json({ error: "未知の action です。" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
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

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { format: true },
  });
  if (event?.format !== "DEATHMATCH") {
    return NextResponse.json(
      { error: "対戦を個別に削除できるのはデスマッチだけです。無効にしてください。" },
      { status: 400 }
    );
  }

  const match = await prisma.eventMatch.findFirst({
    where: { id: params.matchId, eventId: params.id },
    select: { id: true, status: true },
  });
  if (!match) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (match.status !== "SCHEDULED") {
    return NextResponse.json(
      {
        error: "すでに検知・確定した対戦は削除できません。無効にしてください。",
        code: "ALREADY_STARTED",
      },
      { status: 409 }
    );
  }

  await inTx(async (tx) => {
    await tx.eventMatch.delete({ where: { id: match.id } });
    await reopenAggregation(tx, params.id);
  });
  return NextResponse.json({ ok: true });
}

async function downstreamStarted(
  eventId: string,
  round: number,
  position: number
): Promise<boolean> {
  const agg = await prisma.eventMatch.aggregate({
    where: { eventId },
    _max: { round: true },
  });
  const roundCount = agg._max.round ?? round;

  const slot = nextSlot(round, position, roundCount);
  if (!slot) return false;

  const next = await prisma.eventMatch.findFirst({
    where: { eventId, round: slot.round, bracketPosition: slot.position },
    select: { status: true },
  });
  return next ? DOWNSTREAM_STARTED.has(next.status) : false;
}
