import { NextRequest, NextResponse } from "next/server";
import { requireEventOwner } from "@/event/authz";
import { prisma } from "@/lib/prisma";
import { parseJstLocal } from "@/event/datetime";
import { BracketError, createBracket } from "@/event/tournament";

/**
 * トーナメント表を作る(既存の表があれば作り直す)。
 *
 * 進行済みのマッチが1つでもあれば拒否する。検知済みの対戦や確定した勝敗が消えるため。
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { format: true, entryMode: true },
  });
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (event.format !== "TOURNAMENT") {
    return NextResponse.json(
      { error: "バトルトーナメント以外の種目では対戦表を作れません。" },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => null)) as {
    entrantIds?: unknown;
    firstRoundStartAt?: unknown;
    matchWindowMin?: unknown;
    roundIntervalMin?: unknown;
  } | null;

  const entrantIds = Array.isArray(body?.entrantIds)
    ? body!.entrantIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  if (entrantIds.length < 2) {
    return NextResponse.json(
      { error: "トーナメント表を作るには2組以上の参加が必要です。" },
      { status: 400 }
    );
  }
  if (new Set(entrantIds).size !== entrantIds.length) {
    return NextResponse.json({ error: "同じエントリーが重複しています。" }, { status: 400 });
  }

  const startAt =
    typeof body?.firstRoundStartAt === "string" ? parseJstLocal(body.firstRoundStartAt) : null;
  if (!startAt) {
    return NextResponse.json({ error: "1回戦の開始日時を入力してください。" }, { status: 400 });
  }

  const positiveInt = (value: unknown, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n <= 24 * 60 ? Math.round(n) : fallback;
  };

  try {
    const result = await createBracket({
      eventId: params.id,
      entrantIds,
      entryMode: event.entryMode === "TEAM" ? "TEAM" : "SOLO",
      firstRoundStartAt: startAt,
      matchWindowMin: positiveInt(body?.matchWindowMin, 30),
      roundIntervalMin: positiveInt(body?.roundIntervalMin, 45),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof BracketError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "ALREADY_STARTED" ? 409 : 400 }
      );
    }
    throw err;
  }
}
