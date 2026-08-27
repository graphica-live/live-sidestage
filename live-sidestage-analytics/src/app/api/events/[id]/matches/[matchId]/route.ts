import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireEventOwner } from "@/event/authz";
import { prisma } from "@/lib/prisma";
import {
  buildCandidatesFingerprintInput,
  buildSelectionFingerprintInput,
} from "@/event/candidates-fingerprint";
import { validateCandidateGroups } from "@/event/candidate-groups";
import { acquireEventLock } from "@/event/event-lock";
import { parseJstLocal } from "@/event/datetime";
import { downstreamStarted } from "@/event/match-downstream";
import { advanceBracket, resolveMatchSeries } from "@/event/match-results";
import { seriesRequirement, parseMatchRules, type MatchRules } from "@/event/match-rules";
import {
  canAdjustCandidates,
  isByeRow,
  isCandidatesConfirmedByOrganizer,
  isPlainObject,
  withCandidatesConfirmedByOrganizer,
} from "@/event/match-status";
import { resolveEventWindows, type EventWindow } from "@/event/sessions";
import type { MultiplierInput } from "@/event/scoring";
import {
  isTransactionTimeout,
  MUTATION_TX_OPTIONS,
  reopenAggregation,
} from "@/event/reopen-aggregation";
import { assertEventSession, SingleMatchError } from "@/event/single-match";
import type { DbClient } from "@/event/analytics-db";

/** 結果を変えるトランザクション。集計とのロック待ちがあるので既定より長く待つ。 */
function inTx<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, MUTATION_TX_OPTIONS);
}

// 主催者による対戦の手当て。
//
// バトルの自動検知は payload の解釈と両サイドの監視が揃って初めて働くので、
// **検知が失敗しても主催者が手で進められる導線を必ず用意する。**
//
// **結果を変える操作は必ず reopenAggregation を同じトランザクションで呼ぶ。**
// 集計ワーカーは finalizedAt が立ったイベントを飛ばすので、消さないと変更が反映されない。
//
// **状態の読み取りと判定は、すべて acquireEventLock を取った後のトランザクション内で行う。**
// 外で読んで中で書くと、10秒ごとに status を書き換える集計ワーカーや、表を丸ごと
// 作り直す `POST /matches` と競合したときに、古い値で通した判定がそのままコミットされる。
// ロックを先に取る順序は破棄側(tournament.ts)と揃っていないとデッドロックする
// (あちらは「ロック → 行削除」、こちらが「行更新 → ロック」だと逆順になる)。

/** 日程を動かせる状態。検知・確定した後は動かさせない(下の理由を参照)。 */
const RESCHEDULABLE = new Set(["SCHEDULED", "NO_SHOW"]);

/**
 * 承認(`approve`)を許さない検知理由。
 *
 * - `AMBIGUOUS`: 同じ組み合わせの候補が複数あり、どのバトルか決められない
 * - `END_UNKNOWN`: 終了を観測できないまま日程が終わった(区間が確定していない)
 *
 * どちらも「区間が正しい」という前提が無いので、集計に載せてはいけない。
 */
const UNAPPROVABLE_REASONS = new Set(["AMBIGUOUS", "END_UNKNOWN"]);

function reviewReasonOf(rules: unknown): string {
  if (!isPlainObject(rules)) return "";
  return typeof rules.reviewReason === "string" ? rules.reviewReason : "";
}

/**
 * 手動確定(confirm/draw)時に主催者が指定する決着時刻をパースする。
 *
 * 未指定・空文字列は `value: undefined`(呼び出し側が `match.decidedAt ?? new Date()` に
 * フォールバックする、既存の後方互換挙動)。**未来時刻の上限は設けない** — イベント進行の
 * 押し・延びは予測できないため、主催者の裁量を優先する設計判断(2026-08-27)。
 * 無効な形式は `ok: false` を返し、呼び出し側が 400 にする(黙って `new Date()` に
 * フォールバックすると、入力したはずの時刻が捨てられて元のバグが無言で再現するため)。
 */
function parseDecidedAtInput(raw: unknown): { ok: true; value: Date | undefined } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: undefined };
  if (typeof raw !== "string") return { ok: false };
  const parsed = parseJstLocal(raw);
  if (!parsed) return { ok: false };
  return { ok: true, value: parsed };
}

/** 承認・確定・無効化のあとに承認待ちの理由を消す(古い理由をカードに残さない)。 */
function clearReviewReason(rules: unknown): Prisma.InputJsonObject {
  const base: Record<string, unknown> = isPlainObject(rules) ? { ...rules } : {};
  delete base.reviewReason;
  return base as Prisma.InputJsonObject;
}

/**
 * ⚠️トラブル対処フラグ(`forceFullPeriod`)を足す/消す。既存キー(`roundLabel`/`bye`等)は保つ。
 * `reviewReason` と同じ「マージして片方だけ触る」パターン。
 */
function mergeForceFullPeriod(rules: unknown, enabled: boolean): Prisma.InputJsonObject {
  const base: Record<string, unknown> = isPlainObject(rules) ? { ...rules } : {};
  if (enabled) base.forceFullPeriod = true;
  else delete base.forceFullPeriod;
  return base as Prisma.InputJsonObject;
}

/** `reopen`/`void` で⚠️トラブル対処フラグも一緒に消す。フラグは FINISHED にしか存在しない。 */
function clearForceFullPeriod(rules: unknown): Prisma.InputJsonObject {
  const base: Record<string, unknown> = isPlainObject(rules) ? { ...rules } : {};
  delete base.forceFullPeriod;
  return base as Prisma.InputJsonObject;
}

type Action =
  | "approve"
  | "confirm"
  | "draw"
  | "void"
  | "reopen"
  | "assignSession"
  | "selectCandidates"
  | "selectCandidateGroups"
  | "resetCandidates"
  | "forceFullPeriod";

/**
 * 候補一覧の「見た目」の指紋。楽観的排他に使う。検知データ(startedAt/endedAt/confidence/
 * ambiguous)の鮮度を守るためのもので、選択状態(organizerSelected/combinedGroupId)は
 * 見ない(`computeSelectionFingerprint` が別に守る)。
 *
 * **Next.js の route ファイルは HTTP メソッド以外を export できない**ため、テストは
 * 同じ入力文字列(`buildCandidatesFingerprintInput`、`@/event/candidates-fingerprint`)を
 * 使って自前でハッシュ化する(このファイル内の関数は呼べない)。
 */
function computeCandidatesFingerprint(
  candidates: {
    id: string;
    startedAt: Date;
    endedAt: Date | null;
    confidence: string;
    ambiguous: boolean;
  }[]
): string {
  return createHash("sha256").update(buildCandidatesFingerprintInput(candidates)).digest("hex");
}

/**
 * 「主催者が下した選択(organizerSelected/combinedGroupId)」の指紋。`resetCandidates` と、
 * 既に candidatesConfirmedByOrganizer 済みの対戦への再 `selectCandidateGroups` は、
 * `computeCandidatesFingerprint` に加えてこちらも照合する(選択結果を古いタブから
 * 上書き・消去させないため)。
 */
function computeSelectionFingerprint(
  candidates: { id: string; organizerSelected: boolean; combinedGroupId: string | null }[]
): string {
  return createHash("sha256").update(buildSelectionFingerprintInput(candidates)).digest("hex");
}

/** `resolveMatchSeries()` に要る、イベント全体で共通の入力(1トランザクション内で使い回す)。 */
async function loadSeriesInputs(
  tx: DbClient,
  eventId: string
): Promise<{ matchRules: MatchRules; multipliers: MultiplierInput[]; windows: EventWindow[] }> {
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: {
      rules: true,
      startAt: true,
      endAt: true,
      sessions: {
        orderBy: { startAt: "asc" },
        select: { id: true, startAt: true, endAt: true, name: true },
      },
    },
  });
  const multiplierRows = await tx.eventMultiplier.findMany({
    where: { eventId },
    select: { kind: true, factor: true, startAt: true, endAt: true },
  });
  return {
    matchRules: parseMatchRules(event?.rules),
    multipliers: multiplierRows.map((m) => ({
      kind: m.kind,
      factor: m.factor.toString(),
      startAt: m.startAt,
      endAt: m.endAt,
    })),
    windows: resolveEventWindows(
      event ?? { startAt: new Date(0), endAt: new Date(0), sessions: [] }
    ),
  };
}

/**
 * `resolveMatchSeries()` に渡すマッチのスナップショットを読み直す。**候補の
 * `organizerSelected`/`selected` を書き換えた直後は、古いスナップショットではなく
 * 必ずこれで読み直してから呼ぶこと**(でないと直前の書き込みが反映されない状態で判定される)。
 */
async function loadMatchForSeries(tx: DbClient, matchId: string) {
  const match = await tx.eventMatch.findUniqueOrThrow({
    where: { id: matchId },
    select: {
      id: true,
      round: true,
      bracketPosition: true,
      status: true,
      matchType: true,
      winnerSideId: true,
      winnerDecidedBy: true,
      rules: true,
      session: { select: { startAt: true, endAt: true, name: true } },
      sides: {
        orderBy: { sideIndex: "asc" },
        select: {
          id: true,
          sideIndex: true,
          teamId: true,
          participants: {
            select: { participantId: true, participant: { select: { roomId: true } } },
          },
        },
      },
      battleCandidates: {
        orderBy: { startedAt: "asc" },
        select: {
          id: true,
          battleId: true,
          startedAt: true,
          endedAt: true,
          endedAtSource: true,
          confidence: true,
          ambiguous: true,
          organizerSelected: true,
          combinedGroupId: true,
        },
      },
    },
  });
  return match;
}

/** ロック内の検証で弾いたときの応答。トランザクションからはこれを返して外で JSON にする。 */
type Failure = { error: string; code?: string; status: number };

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; matchId: string } }
) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    action?: unknown;
    winnerSideId?: unknown;
    sessionId?: unknown;
    candidateIds?: unknown;
    groups?: unknown;
    candidatesFingerprint?: unknown;
    selectionFingerprint?: unknown;
    enabled?: unknown;
    decidedAt?: unknown;
  } | null;

  const action = body?.action as Action | undefined;
  if (!action) {
    return NextResponse.json({ error: "action を指定してください。" }, { status: 400 });
  }

  // 形式の確認だけは DB を要らないので先に済ませる(不正な入力でロックを取らない)。
  // **この日程がこのイベントのものか**は、ロックの内側で `assertEventSession` が見る。
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  if (action === "assignSession" && !sessionId) {
    return NextResponse.json({ error: "開催日程を選んでください。" }, { status: 400 });
  }

  let failure: Failure | null = null;
  try {
    failure = await inTx(async (tx): Promise<Failure | null> => {
      // **ここから先の読み取りはすべてロックの内側。** 順序は破棄側と揃える。
      await acquireEventLock(tx, params.id);

      const event = await tx.event.findUnique({
        where: { id: params.id },
        select: { format: true },
      });
      if (!event) return { error: "Not found", status: 404 };

      const match = await tx.eventMatch.findFirst({
        where: { id: params.matchId, eventId: params.id },
        select: {
          id: true,
          round: true,
          bracketPosition: true,
          status: true,
          winnerSideId: true,
          winnerDecidedBy: true,
          decidedAt: true,
          rules: true,
          battleCandidates: {
            orderBy: { startedAt: "asc" },
            select: {
              id: true,
              battleId: true,
              startedAt: true,
              endedAt: true,
              confidence: true,
              ambiguous: true,
              organizerSelected: true,
              combinedGroupId: true,
            },
          },
          sides: { select: { id: true, sideIndex: true } },
        },
      });
      if (!match) return { error: "Not found", status: 404 };

      const resultAction =
        action === "confirm" ||
        action === "draw" ||
        action === "void" ||
        action === "reopen" ||
        action === "selectCandidates" ||
        action === "selectCandidateGroups" ||
        action === "resetCandidates";

      // 不戦勝行は主催者が結果を操作する対象ではない(対戦が起きていないので勝者確定・
      // 引き分け・無効化・検知やり直しのいずれも意味を持たない)。段階的不戦勝方式では
      // 相手側が永久に空なので、放置すると検知対象化(部外者との対戦を誤って拾う)や
      // NO_SHOW 化のリスクがある。勝者は match-results.ts の進行処理が自動で決める。
      if (isByeRow(match.rules) && resultAction) {
        return { error: "不戦勝の対戦は結果を変更できません。", code: "BYE_ROW", status: 400 };
      }

      // 勝敗を動かす操作は、次の対戦が始まっていたら拒否する。
      // 進行中の対戦の参加者が途中で入れ替わると、集計対象が変わって結果が壊れるため。
      // **デスマッチには表の進行(nextSlot)が無い**ので、全対戦を毎回スキャンする
      // このチェックはトーナメントだけに絞る(デスマッチの対戦履歴は人数に上限が無い)。
      if (
        resultAction &&
        event.format === "TOURNAMENT" &&
        (await downstreamStarted(tx, params.id, match.round, match.bracketPosition))
      ) {
        return {
          error: "次の対戦がすでに始まっているため、この対戦の結果は変更できません。",
          code: "DOWNSTREAM_STARTED",
          status: 409,
        };
      }

      switch (action) {
        case "approve": {
          // 部分一致や 2vs2 の検知を主催者が認める。勝敗は次の集計で決まる。
          if (match.status !== "NEEDS_REVIEW") {
            return { error: "承認待ちの対戦ではありません。", status: 400 };
          }
          // **候補を特定できていない検知は承認させない。** 承認するとその区間の
          // ギフトがそのまま勝敗とバトル倍率になるが、どのバトルか決まっていない
          // (同じ組み合わせが複数ある / 終了を観測できていない)。
          // 主催者は勝者を手動で確定する(その経路は検知を捨てる)。
          if (UNAPPROVABLE_REASONS.has(reviewReasonOf(match.rules))) {
            return {
              error:
                "どのバトルか特定できていないため承認できません。勝者を手動で確定してください。",
              code: "AMBIGUOUS_DETECTION",
              status: 409,
            };
          }
          await tx.eventMatch.update({
            where: { id: match.id },
            data: { status: "DETECTED", rules: clearReviewReason(match.rules) },
          });
          break;
        }

        case "confirm": {
          const winnerSideId = typeof body?.winnerSideId === "string" ? body.winnerSideId : null;
          if (!winnerSideId || !match.sides.some((s) => s.id === winnerSideId)) {
            return { error: "この対戦のサイドを勝者に指定してください。", status: 400 };
          }
          const decidedAtInput = parseDecidedAtInput(body?.decidedAt);
          if (!decidedAtInput.ok) {
            return { error: "決着時刻の形式が正しくありません。", status: 400 };
          }
          // **特定できていない検知は捨ててから確定する。** 残したままだと、
          // 別のバトルかもしれない区間にバトル倍率が乗り、スコア表示も食い違う。
          const dropDetection = UNAPPROVABLE_REASONS.has(reviewReasonOf(match.rules));
          await tx.eventMatch.update({
            where: { id: match.id },
            // 決着時刻を残す。デスマッチのライフはこの順に適用するので、
            // 検知できていない対戦でも「いつ決まったか」が要る。
            // **すでに確定済みなら動かさない**(同じ操作の再送でライフの順序を変えない)。
            // 主催者が指定した決着時刻(decidedAtInput.value)は、既存の検知結果が
            // 無い場合の new Date() フォールバックより優先する — こちらのほうが実際の
            // 対戦終了時刻に近く、下流ラウンドの feederDecidedAt(検知の下限)の精度が上がる。
            data: {
              status: "FINISHED",
              winnerSideId,
              winnerDecidedBy: "MANUAL",
              decidedAt: match.decidedAt ?? decidedAtInput.value ?? new Date(),
              rules: withCandidatesConfirmedByOrganizer(
                clearReviewReason(match.rules),
                false
              ) as Prisma.InputJsonObject,
              ...(dropDetection
                ? {
                    detectedBattleId: null,
                    detectedStartAt: null,
                    detectedEndAt: null,
                    detectionConfidence: null,
                    detectedEndSource: null,
                  }
                : {}),
            },
          });
          // 手動確定は検知を丸ごと捨てる(既存方針)。候補バトルも複数ゲームぶんまとめて消す。
          if (dropDetection) {
            await tx.eventMatchBattleCandidate.deleteMany({ where: { matchId: match.id } });
          } else {
            // 検知情報は残すが、主催者の選択(organizerSelected/combinedGroupId)は
            // MANUAL 確定によって意味を失う(resolveMatchSeries は MANUAL_DECISIONS を
            // 対象外にする)ので、不変条件を単純に保つためここでもクリアしておく。
            await tx.eventMatchBattleCandidate.updateMany({
              where: { matchId: match.id },
              data: { organizerSelected: false, combinedGroupId: null },
            });
          }
          break;
        }

        case "draw": {
          // 引き分けで確定する。デスマッチでは両者のライフが drawDelta だけ減る。
          // トーナメントでは勝者が出ないと次へ進めないので使わせない。
          const event = await tx.event.findUnique({
            where: { id: params.id },
            select: { format: true },
          });
          if (event?.format !== "DEATHMATCH") {
            return { error: "引き分けで確定できるのはデスマッチだけです。", status: 400 };
          }
          const decidedAtInput = parseDecidedAtInput(body?.decidedAt);
          if (!decidedAtInput.ok) {
            return { error: "決着時刻の形式が正しくありません。", status: 400 };
          }
          // **`confirm` と同じく、特定できていない検知は捨ててから確定する。**
          // 残したままだと、どのバトルか決まっていない区間が
          // `loadBattleRangesByRoom()`(FINISHED かつ両端あり)に拾われて、
          // バトル倍率だけでなく**バトル中のみ集計する種目では順位・貢献の母集団そのもの**
          // になってしまう。決着時刻(ライフの適用順に要る)だけは残す。
          const dropDetection = UNAPPROVABLE_REASONS.has(reviewReasonOf(match.rules));
          await tx.eventMatch.update({
            where: { id: match.id },
            data: {
              status: "FINISHED",
              winnerSideId: null,
              winnerDecidedBy: "DRAW",
              decidedAt: match.decidedAt ?? decidedAtInput.value ?? new Date(),
              rules: withCandidatesConfirmedByOrganizer(
                clearReviewReason(match.rules),
                false
              ) as Prisma.InputJsonObject,
              ...(dropDetection
                ? {
                    detectedBattleId: null,
                    detectedStartAt: null,
                    detectedEndAt: null,
                    detectionConfidence: null,
                    detectedEndSource: null,
                  }
                : {}),
            },
          });
          if (dropDetection) {
            await tx.eventMatchBattleCandidate.deleteMany({ where: { matchId: match.id } });
          } else {
            await tx.eventMatchBattleCandidate.updateMany({
              where: { matchId: match.id },
              data: { organizerSelected: false, combinedGroupId: null },
            });
          }
          break;
        }

        case "void": {
          await tx.eventMatch.update({
            where: { id: match.id },
            data: {
              status: "VOID",
              winnerSideId: null,
              winnerDecidedBy: null,
              decidedAt: null,
              // 無効化した対戦は集計対象から外れるので、⚠️トラブル対処フラグにも意味がない。
              rules: clearForceFullPeriod(clearReviewReason(match.rules)),
            },
          });
          // 集計済みのスコアも消す。無効にした対戦の数字が残っていると
          // 「もう結果が出ている」と読めてしまう。
          await tx.eventMatchSide.updateMany({
            where: { matchId: match.id },
            data: { diamonds: 0, score: 0 },
          });
          // **候補行は削除しない。** `reopen` すれば再検知の余地を残す
          // (VOID は「無効化」であって「検知をやり直す」ではない)。ただし
          // loadBattleRangesByRoom には一切現れないよう selected は倒しておく。
          // combinedGroupId も一緒にクリアする(不変条件「非null ⇒ organizerSelected も
          // true」を保つ fail-safe)。
          await tx.eventMatchBattleCandidate.updateMany({
            where: { matchId: match.id },
            data: { selected: false, organizerSelected: false, combinedGroupId: null },
          });
          break;
        }

        case "reopen": {
          // 検知のやり直し。自動検知の対象へ戻す。**候補行を全削除**し、
          // **`candidatesConfirmedByOrganizer` も明示的に消す**(消し忘れると、
          // 次の検知で新しい候補が入っても「主催者選択済み・0件」のままになる)。
          await tx.eventMatch.update({
            where: { id: match.id },
            data: {
              status: "SCHEDULED",
              winnerSideId: null,
              winnerDecidedBy: null,
              detectedBattleId: null,
              detectedStartAt: null,
              detectedEndAt: null,
              detectionConfidence: null,
              detectedEndSource: null,
              decidedAt: null,
              // 検知をやり直す以上、⚠️トラブル対処フラグ(緊急措置)もリセットして
              // 素直に再評価させる。フラグは FINISHED にしか存在しない不変条件でもある。
              // 主催者の候補選択の確定(`candidatesConfirmedByOrganizer`)も同時に解く。
              rules: withCandidatesConfirmedByOrganizer(
                clearForceFullPeriod(clearReviewReason(match.rules)),
                false
              ) as Prisma.InputJsonObject,
            },
          });
          await tx.eventMatchSide.updateMany({
            where: { matchId: match.id },
            data: { diamonds: 0, score: 0 },
          });
          await tx.eventMatchBattleCandidate.deleteMany({ where: { matchId: match.id } });
          break;
        }

        case "selectCandidates": {
          if (match.status !== "NEEDS_REVIEW" || reviewReasonOf(match.rules) !== "CANDIDATES_EXCEEDED") {
            return { error: "候補選択が必要な対戦ではありません。", status: 400 };
          }

          const rawIds = body?.candidateIds;
          if (!Array.isArray(rawIds) || rawIds.some((v) => typeof v !== "string")) {
            return { error: "candidateIds が不正です。", status: 400 };
          }
          const candidateIds = rawIds as string[];
          if (new Set(candidateIds).size !== candidateIds.length) {
            return { error: "candidateIds に重複があります。", status: 400 };
          }

          const { matchRules } = await loadSeriesInputs(tx, params.id);
          const { maxGames } = seriesRequirement(matchRules.winCondition);
          if (candidateIds.length < 1 || candidateIds.length > maxGames) {
            return { error: `選べる候補は1〜${maxGames}件です。`, status: 400 };
          }

          const byId = new Map(match.battleCandidates.map((c) => [c.id, c]));
          if (!candidateIds.every((id) => byId.has(id))) {
            return { error: "このマッチに存在しない候補が含まれています。", status: 400 };
          }
          if (candidateIds.some((id) => byId.get(id)!.endedAt === null)) {
            return { error: "終了が確定していない候補は選べません。", status: 400 };
          }

          // **楽観的排他。** 選択画面を開いた時点の候補一覧の指紋と、ロックを取った
          // このトランザクション内で読み直した現在の指紋を突き合わせる。ID集合の
          // 増減だけでなく、終了時刻の確定・confidence の変化も拾う
          // (ID集合だけを見る `expectedMatchIds` パターンは、候補の中身の鮮度は保証しない)。
          const expectedFingerprint =
            typeof body?.candidatesFingerprint === "string" ? body.candidatesFingerprint : "";
          if (computeCandidatesFingerprint(match.battleCandidates) !== expectedFingerprint) {
            return {
              error: "この画面を開いた後に候補の内容が変わりました。最新の状態を確認してください。",
              code: "CANDIDATES_CHANGED",
              status: 409,
            };
          }

          await tx.eventMatchBattleCandidate.updateMany({
            where: { matchId: match.id },
            data: { organizerSelected: false },
          });
          await tx.eventMatchBattleCandidate.updateMany({
            where: { matchId: match.id, id: { in: candidateIds } },
            data: { organizerSelected: true },
          });
          await tx.eventMatch.update({
            where: { id: match.id },
            data: {
              rules: withCandidatesConfirmedByOrganizer(
                match.rules,
                true
              ) as Prisma.InputJsonObject,
            },
          });

          {
            const { multipliers, windows } = await loadSeriesInputs(tx, params.id);
            const refreshed = await loadMatchForSeries(tx, match.id);
            await resolveMatchSeries(tx, {
              match: refreshed,
              matchRules,
              multipliers,
              windows,
              now: new Date(),
              downstreamStarted: await downstreamStarted(
                tx,
                params.id,
                match.round,
                match.bracketPosition
              ),
            });
          }
          break;
        }

        case "selectCandidateGroups": {
          // 段階的デプロイ用フラグ(src/event/CLAUDE.md「候補調整モード」参照)。
          // EVENT_WINNER_FEEDER_SWAP と同じパターン: 列追加→reader配布→旧worker消滅確認
          // →writer/UI有効化。フラグが立つまではこの action を常に拒否し、旧クライアントの
          // selectCandidates(合算なし)だけが実働する状態を保つ。
          if (process.env.EVENT_CANDIDATE_GROUPING !== "1") {
            return { error: "未知の action です。", status: 400 };
          }

          // CANDIDATES_EXCEEDED(強制フロー)に加えて、下流未着手・候補2件以上の対戦
          // (canAdjustCandidates)から主催者が任意に開ける「候補調整モード」もこの action で
          // 受け付ける。超過判定の式(resolveMatchSeries側)自体は変更しない — この action は
          // 「主催者が候補群を確定する」という書き込みの起点を増やすだけ。
          const forced =
            match.status === "NEEDS_REVIEW" && reviewReasonOf(match.rules) === "CANDIDATES_EXCEEDED";
          if (
            !forced &&
            !canAdjustCandidates({
              status: match.status,
              winnerDecidedBy: match.winnerDecidedBy,
              candidateCount: match.battleCandidates.length,
            })
          ) {
            return { error: "候補を調整できる対戦ではありません。", status: 400 };
          }

          const rawIds = body?.candidateIds;
          if (!Array.isArray(rawIds) || rawIds.some((v) => typeof v !== "string")) {
            return { error: "candidateIds が不正です。", status: 400 };
          }
          const candidateIds = rawIds as string[];
          if (new Set(candidateIds).size !== candidateIds.length) {
            return { error: "candidateIds に重複があります。", status: 400 };
          }

          const byId = new Map(match.battleCandidates.map((c) => [c.id, c]));
          if (!candidateIds.every((id) => byId.has(id))) {
            return { error: "このマッチに存在しない候補が含まれています。", status: 400 };
          }
          const now = new Date();
          // **未来終了・未終了の候補は選ばせない。** resolveMatchSeries() 側の
          // pool-then-group 化(グループ全体が確定していないと確定させない)と合わせた
          // 二重防御。ここで弾けば、未来終了候補を含むグループが organizerSelected として
          // 保存されること自体を未然に防げる。
          if (
            candidateIds.some((id) => {
              const c = byId.get(id)!;
              return c.endedAt === null || c.endedAt > now;
            })
          ) {
            return { error: "終了が確定していない候補は選べません。", status: 400 };
          }

          const validated = validateCandidateGroups(
            body?.groups,
            candidateIds,
            new Map(candidateIds.map((id) => [id, byId.get(id)!]))
          );
          if (!validated.ok) {
            const messages: Record<string, string> = {
              INVALID_SHAPE: "groups が不正です。",
              GROUP_DUPLICATE_ID: "groups 内で候補IDが重複しています。",
              GROUP_ID_MISMATCH: "groups が candidateIds と一致しません。",
              GROUP_NOT_CONTIGUOUS: "合算グループは連続したバトルでなければなりません。",
            };
            return {
              error: messages[validated.error.code],
              code: validated.error.code,
              status: 400,
            };
          }
          const { groups } = validated;

          const { matchRules } = await loadSeriesInputs(tx, params.id);
          const { maxGames } = seriesRequirement(matchRules.winCondition);
          if (groups.length < 1 || groups.length > maxGames) {
            return { error: `合算後のゲーム数は1〜${maxGames}件にしてください。`, status: 400 };
          }

          // 楽観的排他: 検知データの指紋(既存)+選択状態の指紋(新規)。
          const expectedCandidatesFingerprint =
            typeof body?.candidatesFingerprint === "string" ? body.candidatesFingerprint : "";
          if (computeCandidatesFingerprint(match.battleCandidates) !== expectedCandidatesFingerprint) {
            return {
              error: "この画面を開いた後に候補の内容が変わりました。最新の状態を確認してください。",
              code: "CANDIDATES_CHANGED",
              status: 409,
            };
          }
          const expectedSelectionFingerprint =
            typeof body?.selectionFingerprint === "string" ? body.selectionFingerprint : "";
          if (computeSelectionFingerprint(match.battleCandidates) !== expectedSelectionFingerprint) {
            return {
              error: "この画面を開いた後に選択状態が変わりました。最新の状態を確認してください。",
              code: "SELECTION_CHANGED",
              status: 409,
            };
          }

          await tx.eventMatchBattleCandidate.updateMany({
            where: { matchId: match.id },
            data: { organizerSelected: false, combinedGroupId: null },
          });
          await tx.eventMatchBattleCandidate.updateMany({
            where: { matchId: match.id, id: { in: candidateIds } },
            data: { organizerSelected: true },
          });
          for (const group of groups) {
            if (group.length < 2) continue; // 単独は combinedGroupId=null のままでよい
            await tx.eventMatchBattleCandidate.updateMany({
              where: { matchId: match.id, id: { in: group } },
              data: { combinedGroupId: randomUUID() },
            });
          }
          await tx.eventMatch.update({
            where: { id: match.id },
            data: {
              rules: withCandidatesConfirmedByOrganizer(
                match.rules,
                true
              ) as Prisma.InputJsonObject,
            },
          });

          {
            const { multipliers, windows } = await loadSeriesInputs(tx, params.id);
            const refreshed = await loadMatchForSeries(tx, match.id);
            await resolveMatchSeries(tx, {
              match: refreshed,
              matchRules,
              multipliers,
              windows,
              now,
              downstreamStarted: await downstreamStarted(
                tx,
                params.id,
                match.round,
                match.bracketPosition
              ),
            });
          }
          break;
        }

        case "resetCandidates": {
          if (match.battleCandidates.length === 0) {
            return { error: "候補が1件もありません。", status: 400 };
          }

          // **選択状態の楽観的排他。** 主催者の判断(organizerSelected/combinedGroupId)を
          // 別タブ・古い画面から無条件に消せないようにする。
          const expectedSelectionFingerprint =
            typeof body?.selectionFingerprint === "string" ? body.selectionFingerprint : "";
          if (computeSelectionFingerprint(match.battleCandidates) !== expectedSelectionFingerprint) {
            return {
              error: "この画面を開いた後に選択状態が変わりました。最新の状態を確認してください。",
              code: "SELECTION_CHANGED",
              status: 409,
            };
          }

          await tx.eventMatchBattleCandidate.updateMany({
            where: { matchId: match.id },
            data: { organizerSelected: false, selected: false, combinedGroupId: null },
          });
          await tx.eventMatch.update({
            where: { id: match.id },
            data: {
              winnerSideId: null,
              winnerDecidedBy: null,
              decidedAt: null,
              rules: withCandidatesConfirmedByOrganizer(
                clearReviewReason(match.rules),
                false
              ) as Prisma.InputJsonObject,
            },
          });

          {
            const { matchRules, multipliers, windows } = await loadSeriesInputs(tx, params.id);
            const refreshed = await loadMatchForSeries(tx, match.id);
            await resolveMatchSeries(tx, {
              match: refreshed,
              matchRules,
              multipliers,
              windows,
              now: new Date(),
              downstreamStarted: await downstreamStarted(
                tx,
                params.id,
                match.round,
                match.bracketPosition
              ),
            });
          }
          break;
        }

        case "forceFullPeriod": {
          // ⚠️トラブル対処: バトル検知が失敗して手動確定した対戦のダイヤ救済。
          // 検知区間の代わりに開催日程まるごとを集計対象にする(loadBattleRangesByRoom側)。
          // 通常機能ではないので、確定済み(FINISHED)の対戦にしか設定させない —
          // 「検知をやり直す」「無効にする」を通ると自動的に消える(上のcase参照)。
          if (isByeRow(match.rules)) {
            return { error: "不戦勝の対戦には設定できません。", status: 400 };
          }
          if (match.status !== "FINISHED") {
            return { error: "確定済みの対戦にのみ設定できます。", status: 400 };
          }
          if (typeof body?.enabled !== "boolean") {
            return { error: "enabled を真偽値で指定してください。", status: 400 };
          }
          await tx.eventMatch.update({
            where: { id: match.id },
            data: { rules: mergeForceFullPeriod(match.rules, body.enabled) },
          });
          break;
        }

        case "assignSession": {
          // **検知・確定した後は日程を動かせない。**
          // 日程はバトル検知の対象区間そのもので、動かすと確定済みの検知が
          // その区間の外に出る。デスマッチのライフは決着時刻の順に適用するので、
          // 過去の対戦順が変わって脱落の結果まで変わってしまう。
          // 動かしたい場合は先に「検知をやり直す」で SCHEDULED へ戻す。
          if (!RESCHEDULABLE.has(match.status)) {
            return {
              error: "検知・確定した対戦の日程は変更できません。先に検知をやり直してください。",
              code: "NOT_RESCHEDULABLE",
              status: 409,
            };
          }
          // 日程を読むのもロックの内側。日程の変更と同時に走っても、
          // 消された日程へ割り当てたままコミットされることはない。
          const session = await assertEventSession(tx, params.id, sessionId);
          await tx.eventMatch.update({
            where: { id: match.id },
            data: {
              sessionId,
              // 旧列への dual-write(読まない。旧コードとの同居のためだけに入れる)。
              scheduledStartAt: session.startAt,
              scheduledEndAt: session.endAt,
            },
          });
          break;
        }

        default:
          return { error: "未知の action です。", status: 400 };
      }

      // **勝敗が動いたら、その場で下流へ送る。** 転送は集計ワーカーの周回でも走るが、
      // ワーカーは開催前(SCHEDULED)のイベントを対象にしない(`aggregationWindow`)ので、
      // 事前に組んだ表を確定しても永久に次のラウンドが埋まらない。ロックは
      // このトランザクションの先頭で取ってあるので順序は変わらない。
      // **デスマッチには表の進行(nextSlot)が無い**ので、全対戦を毎回読み込む
      // advanceBracket もトーナメントだけに絞る(デスマッチの対戦履歴は人数に上限が無い)。
      if (resultAction && event.format === "TOURNAMENT") {
        await advanceBracket(tx, params.id);
      }

      await reopenAggregation(tx, params.id);
      return null;
    });
  } catch (err) {
    if (err instanceof SingleMatchError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    if (isTransactionTimeout(err)) return eventBusy();
    throw err;
  }

  if (failure) {
    return NextResponse.json(
      { error: failure.error, ...(failure.code ? { code: failure.code } : {}) },
      { status: failure.status }
    );
  }
  return NextResponse.json({ ok: true });
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
 * 対戦カードを取り消す。まだ検知していない(SCHEDULED)ものだけ。
 *
 * トーナメントの表は枠が繋がっているので個別削除させない。デスマッチ用。
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; matchId: string } }
) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let failure: Failure | null = null;
  try {
    failure = await inTx(async (tx): Promise<Failure | null> => {
      await acquireEventLock(tx, params.id);

      const event = await tx.event.findUnique({
        where: { id: params.id },
        select: { format: true },
      });
      if (event?.format !== "DEATHMATCH") {
        return {
          error: "対戦を個別に削除できるのはデスマッチだけです。無効にしてください。",
          status: 400,
        };
      }

      const match = await tx.eventMatch.findFirst({
        where: { id: params.matchId, eventId: params.id },
        select: { id: true, status: true },
      });
      if (!match) return { error: "Not found", status: 404 };
      if (match.status !== "SCHEDULED") {
        return {
          error: "すでに検知・確定した対戦は削除できません。無効にしてください。",
          code: "ALREADY_STARTED",
          status: 409,
        };
      }

      await tx.eventMatch.delete({ where: { id: match.id } });
      await reopenAggregation(tx, params.id);
      return null;
    });
  } catch (err) {
    if (isTransactionTimeout(err)) return eventBusy();
    throw err;
  }

  if (failure) {
    return NextResponse.json(
      { error: failure.error, ...(failure.code ? { code: failure.code } : {}) },
      { status: failure.status }
    );
  }
  return NextResponse.json({ ok: true });
}
