import { NextRequest, NextResponse } from "next/server";
import { requireEventOwner } from "@/lib/authz";
import { ParticipantError, removeParticipant } from "@/lib/participants";

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
