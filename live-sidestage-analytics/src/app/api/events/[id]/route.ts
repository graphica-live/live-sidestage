import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEventOwner } from "@/event/authz";
import { formatJstRange } from "@/event/datetime";
import { parseDeathmatchRules } from "@/event/deathmatch";
import { refreshEventLeases, releaseEventLeases } from "@/event/participants";
import { MUTATION_TX_OPTIONS, reopenAggregation } from "@/event/reopen-aggregation";
import { parseSessionRequest, windowContaining } from "@/event/sessions";
import { EVENT_STATUSES, validateEventInput, type EventStatus } from "@/event/validation";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    // 存在しないのか権限がないのかを区別しない(他人のイベントIDの存在を漏らさない)。
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // ステータス変更だけの更新
  if (typeof body.status === "string" && body.title === undefined) {
    if (!EVENT_STATUSES.includes(body.status as EventStatus)) {
      return NextResponse.json({ errors: ["ステータスの指定が不正です。"] }, { status: 400 });
    }
    const updated = await prisma.event.update({
      where: { id: params.id },
      data: { status: body.status },
      select: { id: true, slug: true, status: true },
    });
    return NextResponse.json(updated);
  }

  // 種目別ルールだけの更新(デスマッチのライフ設定)。
  if (body.deathmatchRules !== undefined && body.title === undefined) {
    const event = await prisma.event.findUnique({
      where: { id: params.id },
      select: { format: true, rules: true },
    });
    if (event?.format !== "DEATHMATCH") {
      return NextResponse.json(
        { errors: ["ライフの設定を持つのはデスマッチだけです。"] },
        { status: 400 }
      );
    }

    // 値の正規化・範囲の丸めは parseDeathmatchRules に任せる(不正値は既定へ落ちる)。
    const normalized = parseDeathmatchRules({ deathmatch: body.deathmatchRules });
    const existing =
      event.rules && typeof event.rules === "object" && !Array.isArray(event.rules)
        ? (event.rules as Prisma.JsonObject)
        : {};

    await prisma.$transaction(async (tx) => {
      // ライフは全期間再計算なので、ルール変更は過去に遡る。最終集計が済んでいても
      // やり直させないと、新しいルールが順位・脱落に反映されない。
      await reopenAggregation(tx, params.id);
      await tx.event.update({
        where: { id: params.id },
        data: {
          rules: { ...(existing as Prisma.InputJsonObject), deathmatch: { ...normalized } },
        },
      });
    }, MUTATION_TX_OPTIONS);
    return NextResponse.json({ deathmatch: normalized });
  }

  const before = await prisma.event.findUnique({
    where: { id: params.id },
    select: {
      endAt: true,
      sessions: { orderBy: { startAt: "asc" }, select: { startAt: true, endAt: true, name: true } },
    },
  });
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // `sessions` が**無い**リクエストは日程を触らない。旧形式のクライアントが
  // タイトルだけ直したときに、複数日程が外枠1本へ潰れるのを防ぐ。
  // 日程を1件も持たないイベント(この機能より前に作られたもの)だけ、
  // 旧形式の開始・終了から1日程を作る。
  const sessionSource =
    body.sessions !== undefined
      ? body.sessions
      : before.sessions.length > 0
        ? null
        : [{ startAt: body.startAt, endAt: body.endAt }];

  const parsedSessions =
    sessionSource === null
      ? ({ ok: true, value: before.sessions } as const)
      : parseSessionRequest(sessionSource);
  if (!parsedSessions.ok) {
    return NextResponse.json({ errors: parsedSessions.errors }, { status: 400 });
  }

  const validated = validateEventInput({
    title: String(body.title ?? ""),
    description: body.description == null ? null : String(body.description),
    format: String(body.format ?? ""),
    entryMode: String(body.entryMode ?? ""),
    teamPreset: body.teamPreset == null ? undefined : String(body.teamPreset),
    visibility: body.visibility == null ? undefined : String(body.visibility),
    sessions: parsedSessions.value,
  });

  if (!validated.ok) {
    return NextResponse.json({ errors: validated.errors }, { status: 400 });
  }

  const { sessions, ...event } = validated.value;
  const windows = sessions.map((s) => ({ start: s.startAt, end: s.endAt, name: s.name }));

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // 期間を変えたら最終集計をやり直させる。finalizedAt が立ったままだと
      // 延長した分のギフトが二度と集計されない。
      // **これがトランザクションの先頭でロックを取る。** 対戦を組む側も同じロックを
      // 先頭で取るので、古い日程で通した枠が後からコミットされることはない。
      await reopenAggregation(tx, params.id);

      // 日程の外に取り残される対戦がないか確かめる。**勝手に VOID にも移動もしない** —
      // 主催者に、先に対戦の時間を直させる。
      const matches = await tx.eventMatch.findMany({
        where: { eventId: params.id, status: { not: "VOID" } },
        orderBy: { scheduledStartAt: "asc" },
        select: { scheduledStartAt: true, scheduledEndAt: true },
      });
      const stray = matches.filter(
        (m) => !windowContaining(windows, m.scheduledStartAt, m.scheduledEndAt)
      );
      if (stray.length > 0) {
        throw new StrayMatchError(stray.length, stray[0].scheduledStartAt, stray[0].scheduledEndAt);
      }

      // 日程は全置換する。差分更新にすると順序と重なりの検証をやり直す羽目になる。
      await tx.eventSession.deleteMany({ where: { eventId: params.id } });
      await tx.eventSession.createMany({
        data: sessions.map((s) => ({ eventId: params.id, ...s })),
      });

      return tx.event.update({
        where: { id: params.id },
        data: event,
        select: { id: true, slug: true },
      });
    }, MUTATION_TX_OPTIONS);
  } catch (err) {
    if (err instanceof StrayMatchError) {
      return NextResponse.json(
        { errors: [err.message], code: "MATCH_OUT_OF_SESSION" },
        { status: 409 }
      );
    }
    throw err;
  }

  // 終了日時が後ろへ動いたら、確保済みの監視期限も伸ばす。
  if (event.endAt.getTime() > before.endAt.getTime()) {
    await refreshEventLeases(params.id, event.endAt);
  }

  return NextResponse.json(updated);
}

/** 新しい日程に収まらない対戦が残っている。 */
class StrayMatchError extends Error {
  constructor(count: number, start: Date, end: Date) {
    super(
      `対戦の時間枠が新しい開催日程の外に出ます(${count}件。最初は ${formatJstRange(start, end)})。` +
        "先に対戦の時間を変更するか、日程を見直してください。"
    );
    this.name = "StrayMatchError";
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 参加者・lease 台帳は cascade で消えるが、analytics 側の monitorUntil は
  // 明示的に戻さないと期限まで無駄な接続が残る。削除より先に解除する。
  await releaseEventLeases(params.id);

  await prisma.event.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
