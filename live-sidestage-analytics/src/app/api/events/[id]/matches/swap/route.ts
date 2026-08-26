import { NextRequest, NextResponse } from "next/server";
import { requireEventOwner } from "@/event/authz";
import {
  BracketSwapError,
  swapBracketSlots,
  swapWinnerFeeders,
  resetWinnerFeeders,
  type SwapSlot,
  type FeederSwapSlot,
} from "@/event/bracket-swap-apply";
import { isTransactionTimeout } from "@/event/reopen-aggregation";

// トーナメント表の組み合わせ変更。**表を破棄せずに**勝ち残っている出場者を別の枠へ移す。
//
// `mode` で3つの操作を切り替える(省略時は既定で `"leaf"`、既存クライアントとの後方互換):
//
// - `"leaf"`(既定) — 葉スワップ(subtree swap)。`swapBracketSlots()`。下流が未開始のときだけ使える
// - `"feeder"` — 接続の交換(winner feeder edge swap)。`swapWinnerFeeders()`。下流が始まっていても、
//   まだ未実施の対戦の"接続"だけを交換できる。`src/event/CLAUDE.md` 参照
// - `"feeder-reset"` — 接続のリセット。`resetWinnerFeeders()`。`"leaf"` が `FEEDER_OVERRIDDEN` で
//   拒否されたときの唯一の解除経路
//
// スロットは座標ではなく `matchId` + `sideIndex` で指定する — クライアントが見ていた
// カードそのものを指すため。座標で受けると、別タブが上位ラウンドを入れ替えた直後に
// 「同じ座標だが別のカード」を動かしてしまう。
//
// **種目・進行状態・構造の検証はすべて advisory lock の内側**で行う。ここで確かめるのは
// body の型だけ(ロックの外で読んだ値に基づく判断はコミットまでに古くなりうる)。
// 認可の境界は `requireEventOwner`。

/** スロット1つぶんの body を型だけ確かめて取り出す。**要素を間引かない** — 1つでもおかしければ拒否する。 */
function readSlot(value: unknown): SwapSlot | null {
  if (typeof value !== "object" || value === null) return null;
  const slot = value as { matchId?: unknown; sideIndex?: unknown; expectedParticipantIds?: unknown };

  if (typeof slot.matchId !== "string" || slot.matchId.length === 0 || slot.matchId.length > 64) {
    return null;
  }
  if (slot.sideIndex !== 0 && slot.sideIndex !== 1) return null;
  if (!Array.isArray(slot.expectedParticipantIds) || slot.expectedParticipantIds.length > 64) {
    return null;
  }
  if (slot.expectedParticipantIds.some((id) => typeof id !== "string" || id.length === 0)) {
    return null;
  }

  return {
    matchId: slot.matchId,
    sideIndex: slot.sideIndex,
    expectedParticipantIds: slot.expectedParticipantIds as string[],
  };
}

/** 接続交換のスロット1つぶんの body を型だけ確かめて取り出す。 */
function readFeederSlot(value: unknown): FeederSwapSlot | null {
  if (typeof value !== "object" || value === null) return null;
  const slot = value as { matchId?: unknown; sideIndex?: unknown; expectedFeeder?: unknown };

  if (typeof slot.matchId !== "string" || slot.matchId.length === 0 || slot.matchId.length > 64) {
    return null;
  }
  if (slot.sideIndex !== 0 && slot.sideIndex !== 1) return null;
  if (typeof slot.expectedFeeder !== "object" || slot.expectedFeeder === null) return null;

  const feeder = slot.expectedFeeder as {
    round?: unknown;
    position?: unknown;
    matchId?: unknown;
    participantIds?: unknown;
  };
  if (!Number.isInteger(feeder.round) || !Number.isInteger(feeder.position)) return null;
  if ((feeder.position as number) < 0) return null;
  if (typeof feeder.matchId !== "string" || feeder.matchId.length === 0 || feeder.matchId.length > 64) {
    return null;
  }
  if (!Array.isArray(feeder.participantIds) || feeder.participantIds.length > 64) return null;
  if (feeder.participantIds.some((id) => typeof id !== "string" || id.length === 0)) return null;

  return {
    matchId: slot.matchId,
    sideIndex: slot.sideIndex,
    expectedFeeder: {
      round: feeder.round as number,
      position: feeder.position as number,
      matchId: feeder.matchId,
      participantIds: feeder.participantIds as string[],
    },
  };
}

/**
 * 接続の交換(winner feeder edge swap)機能のfeature flag。**既定オフ**
 * (`EVENT_PARTICIPANT_EXISTENCE_CHECK` 等の既存フラグとは極性が逆 — こちらは
 * 新機能なので、段階的デプロイ(reader先行→writer/UI後追い)が完了するまで
 * 明示的に有効化するまで閉じておく。`src/event/CLAUDE.md` のデプロイ計画を参照)。
 */
function feederSwapEnabled(): boolean {
  return process.env.EVENT_WINNER_FEEDER_SWAP === "1";
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

  const body = await req.json().catch(() => null);
  const mode = typeof (body as { mode?: unknown })?.mode === "string" ? (body as { mode: string }).mode : "leaf";

  try {
    if (mode === "feeder" || mode === "feeder-reset") {
      // フラグ無効時は機能自体が存在しないかのように振る舞う(404)。
      if (!feederSwapEnabled()) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    if (mode === "feeder") {
      const { a: rawA, b: rawB } = (body ?? {}) as { a?: unknown; b?: unknown };
      const a = readFeederSlot(rawA);
      const b = readFeederSlot(rawB);
      if (!a || !b) {
        return NextResponse.json({ error: "接続の指定が不正です。" }, { status: 400 });
      }
      await swapWinnerFeeders(params.id, a, b);
      return NextResponse.json({ ok: true });
    }

    if (mode === "feeder-reset") {
      const { matchIds: rawMatchIds } = (body ?? {}) as { matchIds?: unknown };
      let matchIds: string[] | undefined;
      if (rawMatchIds !== undefined) {
        if (
          !Array.isArray(rawMatchIds) ||
          rawMatchIds.length > 256 ||
          rawMatchIds.some((id) => typeof id !== "string" || id.length === 0)
        ) {
          return NextResponse.json({ error: "リセット対象の指定が不正です。" }, { status: 400 });
        }
        matchIds = rawMatchIds as string[];
      }
      await resetWinnerFeeders(params.id, matchIds);
      return NextResponse.json({ ok: true });
    }

    // 既定: 葉スワップ(subtree swap)。`a` が主催者の掴んだ側、`b` が置き先
    // (`b` は空きスロットでもよい、片道移動)。
    const { a: rawA, b: rawB } = (body ?? {}) as { a?: unknown; b?: unknown };
    const a = readSlot(rawA);
    const b = readSlot(rawB);
    if (!a || !b) {
      return NextResponse.json({ error: "入れ替える枠の指定が不正です。" }, { status: 400 });
    }
    await swapBracketSlots(params.id, a, b);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BracketSwapError) {
      return NextResponse.json(
        { error: err.message, code: err.code, details: err.details },
        { status: err.status }
      );
    }
    if (isTransactionTimeout(err)) return eventBusy();
    throw err;
  }
}
