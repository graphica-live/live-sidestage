import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEventOwner } from "@/event/authz";
import { parseDeathmatchRules } from "@/event/deathmatch";
import { parseMatchRules } from "@/event/match-rules";
import { acquireEventLock } from "@/event/event-lock";
import { refreshEventLeases, releaseEventLeases } from "@/event/participants";
import { deleteCoverObject } from "@/lib/media-storage";
import {
  blockingReadinessTasks,
  evaluateEventReadiness,
  loadReadinessInput,
  type ReadinessTask,
} from "@/event/readiness";
import {
  isTransactionTimeout,
  MUTATION_TX_OPTIONS,
  reopenAggregation,
} from "@/event/reopen-aggregation";
import { parseSessionRequest } from "@/event/sessions";
import { applySessionDiff, SessionUpdateError } from "@/event/session-update";
import { isAllowedStatusTransition } from "@/event/status-transition";
import {
  EVENT_STATUSES,
  resolveEventFormatForUpdate,
  validateEventInput,
  type EventStatus,
} from "@/event/validation";

/**
 * 対戦カードが1件でもあるイベントで `matchRules.winCondition` を変えようとしたときに投げる。
 * 種目(`format`)と同じ「作成後は変更できない」扱い — 開催中に検知・勝敗確定ロジックが
 * 前提にする最大試合数・先取本数が変わると、過去の確定結果(FINISHED)が未決着へ戻りうる。
 */
class WinConditionImmutableError extends Error {
  constructor() {
    super("対戦カードを作成した後は勝利条件を変更できません。");
    this.name = "WinConditionImmutableError";
  }
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

type StatusChangeOutcome =
  | { kind: "ok"; event: { id: string; slug: string; status: string } }
  | { kind: "notFound" }
  | { kind: "invalidTransition" }
  | { kind: "notReady"; tasks: ReadinessTask[] };

/**
 * ステータスだけを変える。
 *
 * **`RUNNING` への遷移は「開始・再開」なので、開催準備チェックを通し、
 * 同じトランザクションで `reopenAggregation()` を呼ぶ。**
 * 呼ばないと、締切後に最終集計を終えた(= `finalizedAt` が立った)イベントを
 * 開催中へ戻しても `aggregationWindow()` から外れたままで、二度と集計されない。
 *
 * 判定に使う現在の状態は**ロックの内側で読み直す**。トーナメント表の破棄や日程の更新は
 * 同じ advisory lock を取るので、「表を消しながら同時に開催中にする」競合を止められる。
 * (参加者・チームの削除はこのロックを取らないため、そこまでは直列化されない。
 *  readiness.ts の冒頭に書いたとおりベストエフォートのゲート。)
 */
async function changeEventStatus(
  eventId: string,
  next: EventStatus
): Promise<StatusChangeOutcome> {
  return prisma.$transaction(async (tx) => {
    await acquireEventLock(tx, eventId);

    const current = await tx.event.findUnique({
      where: { id: eventId },
      select: { id: true, slug: true, status: true, format: true, entryMode: true },
    });
    if (!current) return { kind: "notFound" };

    // 同じステータスへの変更は冪等に成功させる(二重クリック・別タブでの先行操作)。
    // 副作用(準備チェック・reopenAggregation)は起こさない。
    if (current.status === next) {
      return {
        kind: "ok",
        event: { id: current.id, slug: current.slug, status: current.status },
      };
    }

    if (!isAllowedStatusTransition(current.status, next)) {
      return { kind: "invalidTransition" };
    }

    if (next === "RUNNING") {
      const readiness = await loadReadinessInput(tx, current);
      const blocking = blockingReadinessTasks(evaluateEventReadiness(readiness));
      if (blocking.length > 0) return { kind: "notReady", tasks: blocking };

      await reopenAggregation(tx, eventId);
    }

    const updated = await tx.event.update({
      where: { id: eventId },
      data: { status: next },
      select: { id: true, slug: true, status: true },
    });
    return { kind: "ok", event: updated };
  }, MUTATION_TX_OPTIONS);
}

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

    let outcome: StatusChangeOutcome;
    try {
      outcome = await changeEventStatus(params.id, body.status as EventStatus);
    } catch (err) {
      if (isTransactionTimeout(err)) return eventBusy();
      throw err;
    }

    if (outcome.kind === "notFound") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (outcome.kind === "invalidTransition") {
      return NextResponse.json(
        {
          errors: ["この状態からは変更できません。画面を再読み込みしてください。"],
          code: "INVALID_STATUS_TRANSITION",
        },
        { status: 409 }
      );
    }
    if (outcome.kind === "notReady") {
      return NextResponse.json(
        {
          errors: outcome.tasks.map((task) => `${task.label}: ${task.detail}`),
          code: "NOT_READY",
          tasks: outcome.tasks,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(outcome.event);
  }

  // 種目別ルールだけの更新(デスマッチのライフ設定)。
  if (body.deathmatchRules !== undefined && body.title === undefined) {
    const event = await prisma.event.findUnique({
      where: { id: params.id },
      select: { format: true },
    });
    if (event?.format !== "DEATHMATCH") {
      return NextResponse.json(
        { errors: ["ライフの設定を持つのはデスマッチだけです。"] },
        { status: 400 }
      );
    }

    // 値の正規化・範囲の丸めは parseDeathmatchRules に任せる(不正値は既定へ落ちる)。
    const normalized = parseDeathmatchRules({ deathmatch: body.deathmatchRules });

    await prisma.$transaction(async (tx) => {
      // ライフは全期間再計算なので、ルール変更は過去に遡る。最終集計が済んでいても
      // やり直させないと、新しいルールが順位・脱落に反映されない。
      await reopenAggregation(tx, params.id);

      // rules はロック取得後にここで読み直す(トランザクション開始前の読み取りだと、
      // 下の一般更新ブランチが同時に matchRules 名前空間を書いたとき、
      // どちらか片方の変更が古いスナップショットで上書きされうる)。
      const current = await tx.event.findUnique({
        where: { id: params.id },
        select: { rules: true },
      });
      const existing =
        current?.rules && typeof current.rules === "object" && !Array.isArray(current.rules)
          ? (current.rules as Prisma.JsonObject)
          : {};

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
      format: true,
      prizeText: true,
      noticeText: true,
      sessions: {
        orderBy: { startAt: "asc" },
        select: { id: true, startAt: true, endAt: true, name: true },
      },
    },
  });
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 種目は作成時にしか決められない。リクエストの値は「今と同じか」の確認にだけ使い、
  // 実際に保存するのは常に既存の値。入力の形式エラーではなく現在の状態との競合なので 409。
  const format = resolveEventFormatForUpdate(before.format, body.format);
  if (!format.ok) {
    return NextResponse.json({ errors: format.errors, code: "FORMAT_IMMUTABLE" }, { status: 409 });
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

  // prizeText/noticeText/matchRules は、body に無ければ現在の値のまま扱う
  // (このフィールドを知らない旧クライアントがタイトルだけ直したとき、デプロイ境目で
  // 既定値へ巻き戻さないため。sessions が無い旧形式リクエストを before.sessions で
  // 補う既存の扱いと同じ考え方)。
  const validated = validateEventInput({
    title: String(body.title ?? ""),
    description: body.description == null ? null : String(body.description),
    format: format.value,
    entryMode: String(body.entryMode ?? ""),
    teamPreset: body.teamPreset == null ? undefined : String(body.teamPreset),
    visibility: body.visibility == null ? undefined : String(body.visibility),
    sessions: parsedSessions.value,
    prizeText: body.prizeText !== undefined ? (body.prizeText == null ? null : String(body.prizeText)) : before.prizeText,
    noticeText:
      body.noticeText !== undefined ? (body.noticeText == null ? null : String(body.noticeText)) : before.noticeText,
    matchRules: body.matchRules,
  });

  if (!validated.ok) {
    return NextResponse.json({ errors: validated.errors }, { status: 400 });
  }

  // matchRules と bracketMethod は rules(JSON) の名前空間なので、実際にリクエストが
  // 送ってきたときだけマージ書き込みする(未送信なら rules 列自体に触らない)。
  //
  // **`bracketMethod` を `event` に残さないこと。** `Event` に同名の列は無いので、
  // そのまま `event.update()` へ渡すと Prisma が `Unknown argument` で落ちる
  // (イベント設定の保存が丸ごと 500 になっていた)。
  const matchRulesProvided = body.matchRules !== undefined;
  const bracketMethodProvided = body.bracketMethod !== undefined;
  const { sessions, matchRules, bracketMethod, ...event } = validated.value;

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // 期間を変えたら最終集計をやり直させる。finalizedAt が立ったままだと
      // 延長した分のギフトが二度と集計されない。
      // **これがトランザクションの先頭でロックを取る。** 対戦を組む側も同じロックを
      // 先頭で取るので、古い日程で通した枠が後からコミットされることはない。
      await reopenAggregation(tx, params.id);

      // **日程は差分更新する。** 対戦が `sessionId` で日程を参照しているので、
      // 全置換(delete → create)すると id が変わって割り当てが壊れる。
      // 検証も含めてロックの内側(このトランザクション)で完結させる。
      await applySessionDiff(tx, params.id, sessions);

      // rules はロック取得後にここで読み直してからマージする(デスマッチ専用ブランチと
      // 同時に走っても、どちらか片方の名前空間が古いスナップショットで消されないように)。
      let rulesPatch: Prisma.InputJsonValue | undefined;
      if (matchRulesProvided || bracketMethodProvided) {
        const current = await tx.event.findUnique({
          where: { id: params.id },
          select: { rules: true },
        });
        const existing =
          current?.rules && typeof current.rules === "object" && !Array.isArray(current.rules)
            ? (current.rules as Prisma.JsonObject)
            : {};

        // **開催後(対戦カードが1件でもある)は勝利条件を変更できない。** ロック取得後に
        // 現在値・件数を読み直す(バリデーションだけの層では DB 件数を扱えないため)。
        if (matchRulesProvided && parseMatchRules(existing).winCondition !== matchRules.winCondition) {
          const matchCount = await tx.eventMatch.count({ where: { eventId: params.id } });
          if (matchCount > 0) throw new WinConditionImmutableError();
        }

        rulesPatch = {
          ...(existing as Prisma.InputJsonObject),
          ...(matchRulesProvided ? { matchRules } : {}),
          ...(bracketMethodProvided ? { bracket: { method: bracketMethod } } : {}),
        };
      }

      return tx.event.update({
        where: { id: params.id },
        data: rulesPatch !== undefined ? { ...event, rules: rulesPatch } : event,
        select: { id: true, slug: true },
      });
    }, MUTATION_TX_OPTIONS);
  } catch (err) {
    if (err instanceof SessionUpdateError) {
      return NextResponse.json(
        { errors: [err.message], code: err.code },
        { status: err.status }
      );
    }
    if (err instanceof WinConditionImmutableError) {
      return NextResponse.json(
        { errors: [err.message], code: "WIN_CONDITION_IMMUTABLE" },
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

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 参加者・lease 台帳は cascade で消えるが、analytics 側の monitorUntil は
  // 明示的に戻さないと期限まで無駄な接続が残る。削除より先に解除する。
  await releaseEventLeases(params.id);

  const existing = await prisma.event.findUnique({
    where: { id: params.id },
    select: { coverImageKey: true },
  });

  // **対戦を先に消す。** 日程への外部キーが Restrict なので、Event の cascade だけに
  // 任せると「日程を先に消しにいって対戦が邪魔をする」順序で落ちうる。
  await prisma.$transaction([
    prisma.eventMatch.deleteMany({ where: { eventId: params.id } }),
    prisma.event.delete({ where: { id: params.id } }),
  ]);

  // ベストエフォート。バケット側の削除に失敗してもイベント削除自体は完了させる。
  if (existing?.coverImageKey) {
    await deleteCoverObject(existing.coverImageKey);
  }

  return NextResponse.json({ ok: true });
}
