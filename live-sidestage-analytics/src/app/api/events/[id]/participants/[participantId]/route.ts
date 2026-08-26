import { NextRequest, NextResponse } from "next/server";
import { requireEventOwner } from "@/event/authz";
import { ParticipantError, removeParticipant, updateParticipant } from "@/event/participants";
import { isTransactionTimeout } from "@/event/reopen-aggregation";
import { parseParticipantPatch } from "@/event/validation";

// 参加者の部分更新。送られてきたキーだけを変える。
// - teamId: null で未所属に戻す
// - displayName: null / 空文字で TikTok ID に戻る
// - tiktokId: 登録ミスの訂正。同じ EventParticipant.id のまま tiktokId/roomId だけ
//   書き換えるので、対戦カード・トーナメント表の枠(EventMatchSideParticipant)は
//   維持される。集計母集団を変える操作なので、集計中は 503(EVENT_BUSY)を返しうる。
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
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ParticipantError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (isTransactionTimeout(err)) {
      return NextResponse.json(
        {
          error: "集計中で混み合っています。少し待ってからやり直してください。",
          code: "EVENT_BUSY",
        },
        { status: 503 }
      );
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
