import { NextRequest, NextResponse } from "next/server";
import { requireEventOwner } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { parseJstLocal } from "@/lib/datetime";
import {
  SingleMatchError,
  createSingleMatch,
  type SingleMatchSide,
} from "@/lib/single-match";

/**
 * サイドの入力。
 *
 * **チーム戦でも「出場する参加者」を明示させる。** チーム全員をサイドに入れると、
 * 検知（サイドの room 集合とバトルの room 集合の一致）が成立しなくなる。
 */
function parseSide(value: unknown): SingleMatchSide {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as { teamId?: unknown; participantIds?: unknown })
    : null;
  const ids = Array.isArray(record?.participantIds) ? record!.participantIds : [];
  return {
    teamId: typeof record?.teamId === "string" && record.teamId ? record.teamId : null,
    participantIds: ids.filter((v): v is string => typeof v === "string" && !!v),
  };
}

/**
 * 対戦カードを1件追加する(デスマッチ用)。
 *
 * トーナメントは表を一括生成する(`POST /api/events/[id]/matches`)。
 * こちらは表を持たない種目で、主催者が随時カードを組むためのもの。
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { format: true },
  });
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (event.format !== "DEATHMATCH") {
    return NextResponse.json(
      { error: "対戦を1件ずつ組めるのはデスマッチだけです。" },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => null)) as {
    sideA?: unknown;
    sideB?: unknown;
    scheduledStartAt?: unknown;
    scheduledEndAt?: unknown;
  } | null;

  const start =
    typeof body?.scheduledStartAt === "string" ? parseJstLocal(body.scheduledStartAt) : null;
  const end = typeof body?.scheduledEndAt === "string" ? parseJstLocal(body.scheduledEndAt) : null;
  if (!start || !end) {
    return NextResponse.json({ error: "開始と終了の日時を入力してください。" }, { status: 400 });
  }

  try {
    const result = await createSingleMatch({
      eventId: params.id,
      sideA: parseSide(body?.sideA),
      sideB: parseSide(body?.sideB),
      scheduledStartAt: start,
      scheduledEndAt: end,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof SingleMatchError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "OVERLAPPING" ? 409 : 400 }
      );
    }
    throw err;
  }
}
