import { NextRequest, NextResponse } from "next/server";
import { requireEventOwner } from "@/event/authz";
import { ParticipantError, registerParticipant } from "@/event/participants";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    tiktokId?: string;
    displayName?: string | null;
    teamId?: string | null;
  } | null;

  if (!body?.tiktokId) {
    return NextResponse.json({ error: "TikTok ID を入力すること。" }, { status: 400 });
  }

  try {
    const result = await registerParticipant({
      eventId: params.id,
      rawTiktokId: body.tiktokId,
      displayName: body.displayName ?? null,
      teamId: body.teamId ?? null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ParticipantError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
