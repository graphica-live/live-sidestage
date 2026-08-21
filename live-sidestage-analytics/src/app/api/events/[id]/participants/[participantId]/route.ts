import { NextRequest, NextResponse } from "next/server";
import { requireEventOwner } from "@/event/authz";
import { prisma } from "@/lib/prisma";
import { ParticipantError, removeParticipant } from "@/event/participants";

// 所属チームの変更。teamId: null で未所属に戻す。
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; participantId: string } }
) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { teamId?: string | null } | null;
  if (!body || body.teamId === undefined) {
    return NextResponse.json({ error: "teamId は必須。" }, { status: 400 });
  }

  if (body.teamId !== null) {
    // 他イベントのチームIDを渡されないよう、必ず eventId 込みで存在確認する。
    const team = await prisma.eventTeam.findFirst({
      where: { id: body.teamId, eventId: params.id },
      select: { id: true },
    });
    if (!team) {
      return NextResponse.json({ error: "指定されたチームが見つからない。" }, { status: 400 });
    }
  }

  const updated = await prisma.eventParticipant.updateMany({
    where: { id: params.participantId, eventId: params.id },
    data: { teamId: body.teamId },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "参加者が見つからない。" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; participantId: string } }
) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await removeParticipant(params.id, params.participantId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ParticipantError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
