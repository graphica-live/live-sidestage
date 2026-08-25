import { NextRequest, NextResponse } from "next/server";
import { requireEventOwner } from "@/event/authz";
import { prisma } from "@/lib/prisma";
import { MAX_BRACKET_SIZE } from "@/event/bracket";
import { isTransactionTimeout } from "@/event/reopen-aggregation";
import { BracketError, createBracket, destroyBracket } from "@/event/tournament";

// トーナメント表の作成と破棄。
//
// **`confirm`(イベント名)の中身は検証しない。** 型だけ見て `tournament.ts` へ渡す —
// 文字列の一致は advisory lock を取った後の `Event.title` と突き合わせないと、
// 名前の変更と競合したときに古い名前への確認で新しい表を消せてしまう。
//
// 認可の境界は `requireEventOwner` で、`confirm` は誤操作を止める儀式にすぎない
// (イベント名は公開ページに出るので秘密ではない)。

/** リクエストボディの `confirm` / `expectedMatchIds` を型だけ確かめて取り出す。 */
function readConfirmation(body: { confirm?: unknown; expectedMatchIds?: unknown } | null) {
  return {
    confirm: typeof body?.confirm === "string" ? body.confirm : undefined,
    expectedMatchIds: Array.isArray(body?.expectedMatchIds)
      ? body!.expectedMatchIds.filter((v): v is string => typeof v === "string")
      : undefined,
  };
}

function bracketErrorResponse(err: BracketError) {
  const status =
    err.code === "ALREADY_STARTED" || err.code === "BRACKET_CHANGED" ? 409 : 400;
  return NextResponse.json({ error: err.message, code: err.code }, { status });
}

/**
 * 手動配置(1回戦の枠に置いたエントリー)を取り出す。**位置そのものが意味を持つので、
 * 不正な要素を `.filter()` で間引かない** — 間引くと主催者が置いた場所とずれた表が
 * 黙って作られる。1つでもおかしければ配列ごと拒否する。
 *
 * 中身の妥当性(枠数と配置数の対応・重複・実在するエントリーか)はロックの内側で見る。
 * ここで確かめるのは型と長さだけ。
 */
function readPlacement(
  value: unknown
): { ok: true; value: (string | null)[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "配置の形式が不正です。" };
  }
  if (value.length > MAX_BRACKET_SIZE) {
    return { ok: false, error: `トーナメント表の枠は${MAX_BRACKET_SIZE}までです。` };
  }
  const slots: (string | null)[] = [];
  for (const slot of value) {
    if (slot === null) {
      slots.push(null);
      continue;
    }
    if (typeof slot !== "string" || slot.length === 0 || slot.length > 64) {
      return { ok: false, error: "配置の形式が不正です。" };
    }
    slots.push(slot);
  }
  return { ok: true, value: slots };
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

/**
 * トーナメント表を作る(既存の表があれば作り直す)。
 *
 * 進行済みのマッチを含む表を破棄するには `confirm` にイベント名が要る。
 * 何も進行していない表は従来どおり確認なしで置き換える。
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
  if (event.format !== "TOURNAMENT") {
    return NextResponse.json(
      { error: "バトルトーナメント以外の種目では対戦表を作れません。" },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => null)) as {
    entrantIds?: unknown;
    placement?: unknown;
    roundSessionIds?: unknown;
    confirm?: unknown;
    expectedMatchIds?: unknown;
  } | null;

  // **シード順(`entrantIds`)と手動配置(`placement`)は排他。** 両方来たときにどちらかを
  // 優先すると、片方の意図が黙って捨てられる。
  const hasEntrantIds = body?.entrantIds !== undefined;
  const hasPlacement = body?.placement !== undefined;
  if (hasEntrantIds === hasPlacement) {
    return NextResponse.json(
      { error: "シード順と手動配置はどちらか一方だけを指定してください。" },
      { status: 400 }
    );
  }

  // ラウンドごとの開催日程。**中身の妥当性(このイベントの日程か、順番が逆行しないか)は
  // ロックを取った後の `createBracket` が見る。** ここは型だけ確かめる。
  const roundSessionIds = Array.isArray(body?.roundSessionIds)
    ? body!.roundSessionIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : undefined;

  let source: { entrantIds: string[] } | { placement: (string | null)[] };
  if (hasPlacement) {
    const placement = readPlacement(body!.placement);
    if (!placement.ok) {
      return NextResponse.json({ error: placement.error }, { status: 400 });
    }
    source = { placement: placement.value };
  } else {
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
    source = { entrantIds };
  }

  try {
    const result = await createBracket({
      eventId: params.id,
      ...source,
      roundSessionIds,
      ...readConfirmation(body),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof BracketError) return bracketErrorResponse(err);
    if (isTransactionTimeout(err)) return eventBusy();
    throw err;
  }
}

/**
 * トーナメント表を破棄する(作り直さない)。
 *
 * 参加者が2組未満に減った・メンバー0のチームが混ざった等、`POST` が永久に成功しない
 * 状態でも古い表を消せるようにするための経路。**イベント名の入力が必須。**
 *
 * デスマッチには使わせない。個別に組んだ対戦まで巻き込むうえ、あちらには
 * `DELETE /matches/:matchId` がある。
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
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
  if (event.format !== "TOURNAMENT") {
    return NextResponse.json(
      { error: "トーナメント表を破棄できるのはバトルトーナメントだけです。" },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => null)) as {
    confirm?: unknown;
    expectedMatchIds?: unknown;
  } | null;

  try {
    const result = await destroyBracket(params.id, readConfirmation(body));
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BracketError) return bracketErrorResponse(err);
    if (isTransactionTimeout(err)) return eventBusy();
    throw err;
  }
}
