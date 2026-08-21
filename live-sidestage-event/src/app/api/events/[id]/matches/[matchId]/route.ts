import { NextRequest, NextResponse } from "next/server";
import { requireEventOwner } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { parseJstLocal } from "@/lib/datetime";
import { nextSlot } from "@/lib/bracket";

// 主催者による対戦の手当て。
//
// バトルの自動検知は payload の解釈と両サイドの監視が揃って初めて働くので、
// **検知が失敗しても主催者が手で進められる導線を必ず用意する。**

/** 下流の対戦がこの状態に入っていたら、上流の勝敗は動かさせない。 */
const DOWNSTREAM_STARTED = new Set(["LIVE", "DETECTED", "NEEDS_REVIEW", "FINISHED"]);

type Action = "approve" | "confirm" | "void" | "reopen" | "schedule";

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
  if (action === "confirm" || action === "void" || action === "reopen") {
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
      await prisma.eventMatch.update({
        where: { id: match.id },
        data: { status: "DETECTED" },
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
      await prisma.eventMatch.update({
        where: { id: match.id },
        data: { status: "FINISHED", winnerSideId, winnerDecidedBy: "MANUAL" },
      });
      break;
    }

    case "void": {
      await prisma.eventMatch.update({
        where: { id: match.id },
        data: { status: "VOID", winnerSideId: null, winnerDecidedBy: null },
      });
      break;
    }

    case "reopen": {
      // 検知のやり直し。自動検知の対象へ戻す。
      await prisma.eventMatch.update({
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
      break;
    }

    case "schedule": {
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
      await prisma.eventMatch.update({
        where: { id: match.id },
        data: { scheduledStartAt: start, scheduledEndAt: end },
      });
      break;
    }

    default:
      return NextResponse.json({ error: "未知の action です。" }, { status: 400 });
  }

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
