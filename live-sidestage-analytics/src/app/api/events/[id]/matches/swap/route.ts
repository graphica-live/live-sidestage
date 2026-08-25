import { NextRequest, NextResponse } from "next/server";
import { requireEventOwner } from "@/event/authz";
import { BracketSwapError, swapBracketSlots, type SwapSlot } from "@/event/bracket-swap-apply";
import { isTransactionTimeout } from "@/event/reopen-aggregation";

// トーナメント表の組み合わせ変更。**表を破棄せずに**勝ち残っている出場者を別の枠へ移す。
//
// スロットは座標ではなく `matchId` + `sideIndex` で指定する — クライアントが見ていた
// カードそのものを指すため。座標で受けると、別タブが上位ラウンドを入れ替えた直後に
// 「同じ座標だが別のカード」を動かしてしまう。
//
// **種目・進行状態・構造の検証はすべて `applyBracketSwap()` の advisory lock の内側**で行う。
// ここで確かめるのは body の型だけ(ロックの外で読んだ値に基づく判断はコミットまでに
// 古くなりうる)。認可の境界は `requireEventOwner`。

/** スロット1つぶんの body を型だけ確かめて取り出す。**要素を間引かない** — 1つでもおかしければ拒否する。 */
function readSlot(value: unknown): SwapSlot | null {
  if (typeof value !== "object" || value === null) return null;
  const slot = value as { matchId?: unknown; sideIndex?: unknown; expectedParticipantIds?: unknown };

  if (typeof slot.matchId !== "string" || slot.matchId.length === 0 || slot.matchId.length > 64) {
    return null;
  }
  if (slot.sideIndex !== 0 && slot.sideIndex !== 1) return null;
  if (!Array.isArray(slot.expectedParticipantIds)) return null;
  if (slot.expectedParticipantIds.some((id) => typeof id !== "string" || id.length === 0)) {
    return null;
  }

  return {
    matchId: slot.matchId,
    sideIndex: slot.sideIndex,
    expectedParticipantIds: slot.expectedParticipantIds as string[],
  };
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

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { a?: unknown; b?: unknown } | null;
  // `a` が主催者の掴んだ側、`b` が置き先。`b` は空きスロットでもよい(片道移動)。
  const a = readSlot(body?.a);
  const b = readSlot(body?.b);
  if (!a || !b) {
    return NextResponse.json({ error: "入れ替える枠の指定が不正です。" }, { status: 400 });
  }

  try {
    await swapBracketSlots(params.id, a, b);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BracketSwapError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (isTransactionTimeout(err)) return eventBusy();
    throw err;
  }
}
