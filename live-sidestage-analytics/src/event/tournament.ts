import { prisma } from "@/lib/prisma";
import type { DbClient } from "./analytics-db";
import {
  resolveBracket,
  resolveManualBracket,
  roundLabel,
  stagedRoundLabel,
  validatePlacement,
} from "./bracket";
import { parseBracketMethod } from "./bracket-rules";
import { acquireEventLock } from "./event-lock";
import { MUTATION_TX_OPTIONS, reopenAggregation } from "./reopen-aggregation";

// トーナメント表の作成。主催者が「表を作る」を実行したときに1回だけ走る。
//
// **既存の表がある状態では作らない。** 作り直しは「破棄(`destroyBracket`) → 作成」の
// 2手順に分けてある。`createBracket` が古い表を消してから作り直す方式は廃止した —
// 1回の操作に「消す」と「作る」が同居していて、確認の要否・楽観的排他・作成の失敗時の
// 巻き戻しがすべてこの1経路に集まり、主催者から見て何が起きるのか読めなくなっていた。
//
// 進行(勝者を次のラウンドへ送る)は match-results.ts が集計のたびに作り直すので、
// ここでやるのは枠を用意することと、不戦勝を確定させることだけ。
//
// **対戦に個別の時間枠は持たせない。** ラウンドごとに「どの開催日程で行うか」だけを決める
// (バトルの検知はその日程まるごとが対象)。1回戦の開始時刻・試合枠・ラウンド間隔から
// 予定表を組む方式は廃止した — 主催者が事前に総所要時間を見積もれないと表すら作れず、
// 進行が押すたびに枠を引き直す必要があったため。

/**
 * 表の中身の決め方。**どちらか一方だけを渡す**(両方・どちらも無しは呼び出し側で弾く)。
 *
 * - `entrantIds`: シード順(強い順)。配置はイベントの方式(標準/段階的)が決める
 * - `placement`: 主催者が1回戦の枠へ直接置いた配置。配列長がそのまま枠数で、null は空き枠
 *
 * 「両方来たら placement を優先」にはしない。曖昧な入力を黙って別の意味で処理すると、
 * 旧クライアントの `entrantIds` が新サーバーで無視される事故を検知できない。
 */
type BracketPlanSource =
  | { entrantIds: string[]; placement?: undefined }
  | { placement: (string | null)[]; entrantIds?: undefined };

export type BracketPlanInput = BracketPlanSource & {
  eventId: string;
  /**
   * ラウンド順(1回戦から)に、そのラウンドを行う開催日程の id。
   * 省略・空なら全ラウンドを最初の日程に置く。
   */
  roundSessionIds?: string[];
};

export class BracketError extends Error {
  constructor(
    message: string,
    readonly code:
      | "TOO_FEW_ENTRANTS"
      | "BRACKET_EXISTS"
      | "INVALID_SESSION"
      | "UNKNOWN_ENTRANT"
      | "CONFIRM_MISMATCH"
      | "BRACKET_CHANGED"
      | "INVALID_PLACEMENT"
  ) {
    super(message);
    this.name = "BracketError";
  }
}

/**
 * 各ラウンドを行う日程を決める。
 *
 * - 指定が無ければ全ラウンドを最初の日程に置く(1日で終わるイベントが大半)
 * - 指定があるなら、ラウンド数ぶん揃っていて、すべてこのイベントの日程で、
 *   **後のラウンドが前のラウンドより前の日程にならない**こと
 *   (2回戦の日程を1回戦より前に置くと、勝者が決まる前の時間帯で検知することになる)
 */
export function planRoundSessions(input: {
  sessions: { id: string; startAt: Date }[];
  roundCount: number;
  requested?: string[];
}): { ok: true; value: string[] } | { ok: false; error: string } {
  const { sessions, roundCount, requested } = input;
  if (sessions.length === 0) {
    return { ok: false, error: "先に開催日程を登録してください。" };
  }

  const ordered = [...sessions].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  if (!requested || requested.length === 0) {
    return { ok: true, value: Array.from({ length: roundCount }, () => ordered[0].id) };
  }

  if (requested.length !== roundCount) {
    return { ok: false, error: `ラウンドは${roundCount}つあります。すべての日程を選んでください。` };
  }

  const orderById = new Map(ordered.map((s, index) => [s.id, index]));
  let previous = -1;
  for (const [round, sessionId] of requested.entries()) {
    const index = orderById.get(sessionId);
    if (index === undefined) {
      return { ok: false, error: "このイベントに存在しない開催日程が指定されています。" };
    }
    if (index < previous) {
      return {
        ok: false,
        error: `${round + 1}回戦の日程が前のラウンドより前になっています。`,
      };
    }
    previous = index;
  }

  return { ok: true, value: [...requested] };
}

/**
 * トーナメント表を作る。**既存の表があるイベントでは作らない**(`BRACKET_EXISTS`)。
 *
 * 作り直したいときは先に `destroyBracket()` で破棄する。表を消すのはこの関数の仕事では
 * ないので、確認(イベント名)も楽観的排他も受け取らない — 消えるものが無いなら儀式も要らない。
 */
export async function createBracket(input: BracketPlanInput): Promise<{ matches: number }> {
  const { eventId, placement, roundSessionIds } = input;

  // 手動配置は「どの枠へ置いたか」がそのまま構造になるので、エントリーの一覧は配置から導く。
  if (placement) {
    const valid = validatePlacement(placement);
    if (!valid.ok) throw new BracketError(valid.error, "INVALID_PLACEMENT");
  }
  const entrantIds = placement
    ? placement.filter((id): id is string => id !== null)
    : input.entrantIds;

  if (entrantIds.length < 2) {
    throw new BracketError("トーナメント表を作るには2組以上の参加が必要です。", "TOO_FEW_ENTRANTS");
  }

  return prisma.$transaction(async (tx) => {
    // **日程を読む前にロックを取る。** 日程の変更と同時に走ると、古い日程で
    // 組んだ枠がそのままコミットされて日程の外に取り残される。
    await acquireEventLock(tx, eventId);

    // **既存の表がある間は何も作らない。** 数えるのはロックの内側なので、同時に届いた
    // 2つの作成リクエストは直列化され、片方だけが成功する(もう片方はここで弾かれる)。
    // 検証より先に見るのは、主催者に返す理由を「先に破棄すること」1つに寄せるため。
    const existing = await tx.eventMatch.count({ where: { eventId } });
    if (existing > 0) {
      throw new BracketError(
        "すでにトーナメント表があります。作り直すときは先に表を破棄してください。",
        "BRACKET_EXISTS"
      );
    }

    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: {
        entryMode: true,
        rules: true,
        sessions: {
          orderBy: { startAt: "asc" },
          select: { id: true, startAt: true, endAt: true },
        },
      },
    });
    if (!event) throw new BracketError("イベントが見つかりません。", "UNKNOWN_ENTRANT");

    // **エントリーの解決もロックの内側でやる。** 参加形式(SOLO/TEAM)は主催者が
    // 変更できるので、外で読むと古い判定のまま新しい表がコミットされうる。
    const entryMode = event.entryMode === "TEAM" ? "TEAM" : "SOLO";
    const participantsByEntrant = await resolveEntrantParticipants(
      tx,
      eventId,
      entrantIds,
      entryMode
    );

    // ブラケット方式はイベントの rules から読む(主催者が作成ウィザードで決めた値)。
    // 表を作るたびに読み直すので、旧方式で作った表を消して別方式で作り直すこともできる。
    //
    // **手動配置のときは方式を参照しない。** 誰と誰が当たるかは主催者の配置がすべてで、
    // 不戦勝の配り方も配置から決まる。ラウンド名は「N人制」を出さない側を使う
    // (空き枠のせいでラウンドごとの実人数が2のべき乗の等比にならないため)。
    const method = parseBracketMethod(event.rules);
    const bracket = placement ? resolveManualBracket(placement) : resolveBracket(entrantIds, method);
    const label = placement || method === "STAGED_BYE" ? stagedRoundLabel : roundLabel;

    const roundSessions = planRoundSessions({
      sessions: event.sessions,
      roundCount: bracket.roundCount,
      requested: roundSessionIds,
    });
    if (!roundSessions.ok) {
      throw new BracketError(roundSessions.error, "INVALID_SESSION");
    }

    const sessionById = new Map(event.sessions.map((s) => [s.id, s]));

    for (const match of bracket.matches) {
      const sessionId = roundSessions.value[match.round - 1];
      const session = sessionById.get(sessionId)!;
      // 片方が BYE の行は「不戦勝行」として印を残す。静的(相手が確定済みの ENTRANT)・
      // 動的(段階的方式で、相手がまだ勝者未確定の WINNER_OF)のどちらも該当する。
      // match-results.ts の進行処理と [matchId] API の操作ガードがこの印を見る
      // (詳細はそれぞれのファイルのコメントを参照)。
      const isBye = match.isBye;
      const created = await tx.eventMatch.create({
        data: {
          eventId,
          round: match.round,
          bracketPosition: match.position,
          matchType: "1V1",
          sessionId,
          // **旧列への dual-write。** 読むのは日程だけだが、ローリング更新やロールバックで
          // 旧コードが同時に動いても必須列が null にならないよう、日程の窓を入れておく。
          scheduledStartAt: session.startAt,
          scheduledEndAt: session.endAt,
          status: "SCHEDULED",
          rules: {
            roundLabel: label(match.round, bracket.roundCount),
            ...(isBye ? { bye: true } : {}),
          },
        },
      });

      for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
        const entrantId = match.sideIds[sideIndex];
        const side = await tx.eventMatchSide.create({
          data: {
            matchId: created.id,
            sideIndex,
            teamId: entryMode === "TEAM" ? entrantId : null,
          },
        });

        const participantIds = entrantId ? (participantsByEntrant.get(entrantId) ?? []) : [];
        if (participantIds.length > 0) {
          await tx.eventMatchSideParticipant.createMany({
            data: participantIds.map((participantId) => ({ sideId: side.id, participantId })),
          });
        }
      }

      // 不戦勝。バトルは起きないので検知を待たずに確定させる。
      // 勝者を次のラウンドへ送るのは match-results.ts が集計のたびに行う。
      if (match.autoWinnerSide !== null) {
        const sides = await tx.eventMatchSide.findMany({
          where: { matchId: created.id },
          select: { id: true, sideIndex: true },
        });
        const winner = sides.find((s) => s.sideIndex === match.autoWinnerSide);
        if (winner) {
          await tx.eventMatch.update({
            where: { id: created.id },
            data: { status: "FINISHED", winnerSideId: winner.id, winnerDecidedBy: "BYE" },
          });
        }
      }
    }

    // 表を作ったら、最終集計が済んでいても結果が変わる。**破棄と作成が別の操作になった今は
    // ここが要る** — 表の無い状態でワーカーが最終集計を終えていても、作成で再開させる。
    await reopenAggregation(tx, eventId);

    return { matches: bracket.matches.length };
  }, MUTATION_TX_OPTIONS);
}

/**
 * トーナメント表を破棄する。**表がある状態でできる操作はこれだけ**で、作り直したい主催者は
 * 破棄してから改めて `createBracket()` で作る。
 *
 * `createBracket` が永久に成功しない状態 — 参加者が2組未満に減った、日程を縮めて
 * 全ラウンドが収まらない、メンバー0のチームが混ざった — でも古い表を消せる必要があるので、
 * 破棄は作成の条件を一切見ない。
 *
 * **明示的な破壊操作なので、進行状態にかかわらずイベント名の確認を要求する。**
 */
export async function destroyBracket(
  eventId: string,
  options: { confirm?: string; expectedMatchIds?: string[] } = {}
): Promise<{ destroyed: number }> {
  return prisma.$transaction(async (tx) => {
    await acquireEventLock(tx, eventId);

    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { title: true },
    });
    if (!event) throw new BracketError("イベントが見つかりません。", "UNKNOWN_ENTRANT");

    const destroyed = await clearBracket(tx, eventId, {
      eventTitle: event.title,
      confirm: options.confirm,
      expectedMatchIds: options.expectedMatchIds,
    });

    // 表を消したら順位・ライフが変わる。最終集計が済んでいても計算し直させる。
    // **1件も消さなかったなら呼ばない** — 空撃ちのたびに finalizedAt が外れて、
    // 確定済みのイベントが再集計に戻ってしまう。
    if (destroyed > 0) await reopenAggregation(tx, eventId);
    return { destroyed };
  }, MUTATION_TX_OPTIONS);
}

/**
 * 既存のトーナメント表を消す。**必ず `acquireEventLock` を取ったトランザクションの中から呼ぶ。**
 *
 * `EventMatchSide` / `EventMatchSideParticipant` は `onDelete: Cascade` なので一緒に消える。
 * **`DetectedBattle` は消さない** — `eventId` を持たない共有テーブルで、他イベントも
 * 参照しうる。次の `detectMatches` が新しい表へ照合し直す。
 */
async function clearBracket(
  tx: DbClient,
  eventId: string,
  options: {
    eventTitle: string;
    confirm?: string;
    expectedMatchIds?: string[];
  }
): Promise<number> {
  const existing = await tx.eventMatch.findMany({
    where: { eventId },
    select: { id: true },
  });

  // クライアントが見ていた表と違うなら、その判断は古い。別タブが作り直した表を、
  // 主催者の知らないうちに消さないための楽観的排他。
  //
  // **保証するのは「同じ表かどうか」だけで、行の中身の鮮度ではない。** 確認ダイアログを
  // 開いてからイベント名を入力するまでの間に、同じ行が検知・確定されても破棄は通る
  // (ダイアログの「消える結果」は開いた時点のスナップショット)。status まで照合条件に
  // 入れると、10秒ごとに status を書き換える集計ワーカーと競合して、開催中のイベントは
  // 破棄そのものができなくなる — 壊れた表を捨てる最後の経路なので、そこは通す側に倒す。
  if (options.expectedMatchIds) {
    const now = new Set(existing.map((m) => m.id));
    const expected = new Set(options.expectedMatchIds);
    const same = now.size === expected.size && [...now].every((id) => expected.has(id));
    if (!same) {
      throw new BracketError(
        "この画面を開いた後にトーナメント表が変わりました。最新の状態を確認してください。",
        "BRACKET_CHANGED"
      );
    }
  }

  // **確認は「消すものが無い」より先に見る。** ここを後回しにすると、空の表に対して
  // 確認なしの破棄が 200 で通り、呼び出し側の後始末(reopenAggregation)だけが走る。
  assertConfirmed(options.confirm, options.eventTitle);

  if (existing.length === 0) return 0;

  await tx.eventMatch.deleteMany({ where: { eventId } });
  return existing.length;
}

/**
 * 主催者が入力したイベント名を、ロック内で読み直した `Event.title` と突き合わせる。
 *
 * **route 層で比較しない。** イベント名は主催者が変更できるので、ロックの外で読むと
 * 名前の変更と競合したときに「古い名前への確認で、新しい名前のイベントの表を消す」
 * ことができてしまう。
 *
 * なおこれは誤操作を止めるための儀式であって、認可ではない(イベント名は公開ページに
 * 出るので秘密ではない)。認可の境界は API 側の `requireEventOwner`。
 */
function assertConfirmed(confirm: string | undefined, eventTitle: string): void {
  if (typeof confirm === "string" && confirm.trim() === eventTitle.trim()) return;

  throw new BracketError(
    "確認のため、イベント名を正確に入力してください。",
    "CONFIRM_MISMATCH"
  );
}

/** エントリーID → そのサイドに入る参加者IDの一覧。 */
async function resolveEntrantParticipants(
  tx: DbClient,
  eventId: string,
  entrantIds: string[],
  entryMode: "SOLO" | "TEAM"
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();

  if (entryMode === "TEAM") {
    const teams = await tx.eventTeam.findMany({
      where: { eventId, id: { in: entrantIds } },
      select: { id: true, participants: { where: { status: "ACTIVE" }, select: { id: true } } },
    });
    for (const team of teams) {
      // メンバーのいないチームを表に入れると、そのサイドの room が空になり、
      // バトルの検知(サイドの room 集合との一致)が永久に成立しない。
      if (team.participants.length === 0) {
        throw new BracketError(
          "参加者が1人もいないチームが含まれています。先に参加者をチームへ入れてください。",
          "UNKNOWN_ENTRANT"
        );
      }
      map.set(team.id, team.participants.map((p) => p.id));
    }
  } else {
    const participants = await tx.eventParticipant.findMany({
      where: { eventId, id: { in: entrantIds }, status: "ACTIVE" },
      select: { id: true },
    });
    for (const p of participants) map.set(p.id, [p.id]);
  }

  const missing = entrantIds.filter((id) => !map.has(id));
  if (missing.length > 0) {
    throw new BracketError(
      `このイベントに存在しないエントリーが含まれています: ${missing.join(", ")}`,
      "UNKNOWN_ENTRANT"
    );
  }

  return map;
}

/**
 * シード順の既定値を作る。
 *
 * 現在の順位表(獲得ダイヤ)があればその順、なければ登録順。主催者は並べ替えできる。
 */
export async function defaultSeedOrder(
  eventId: string,
  entryMode: "SOLO" | "TEAM"
): Promise<string[]> {
  const subjectType = entryMode === "TEAM" ? "TEAM" : "PARTICIPANT";
  const standings = await prisma.eventStanding.findMany({
    where: { eventId, subjectType },
    orderBy: { rank: "asc" },
    select: { subjectId: true },
  });
  if (standings.length > 0) return standings.map((s) => s.subjectId);

  if (entryMode === "TEAM") {
    const teams = await prisma.eventTeam.findMany({
      where: { eventId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true },
    });
    return teams.map((t) => t.id);
  }

  const participants = await prisma.eventParticipant.findMany({
    where: { eventId, status: "ACTIVE" },
    orderBy: { joinedAt: "asc" },
    select: { id: true },
  });
  return participants.map((p) => p.id);
}
