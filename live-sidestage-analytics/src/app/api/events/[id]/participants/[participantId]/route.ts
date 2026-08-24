import { NextRequest, NextResponse } from "next/server";
import { requireEventOwner } from "@/event/authz";
import { ParticipantError, removeParticipant, updateParticipant } from "@/event/participants";
import { parseParticipantPatch } from "@/event/validation";

// 参加者の部分更新。送られてきたキーだけを変える。
// - teamId: null で未所属に戻す
// - displayName: null / 空文字で TikTok ID に戻る
// 検証と書き込みは updateParticipant に閉じてある(部分適用させないため)。
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; participantId: string } }
) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = parseParticipantPatch(await req.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.errors[0] }, { status: 400 });
  }

  try {
    const result = await updateParticipant({
      eventId: params.id,
      participantId: params.participantId,
      patch: parsed.value,
    });
    return NextResponse.json({ ok: true, displayName: result.displayName });
  } catch (err) {
    if (err instanceof ParticipantError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
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
