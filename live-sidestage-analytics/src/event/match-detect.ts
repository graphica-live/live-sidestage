import { isReadyForDetection } from "./match-status";

// 主催者が組んだ対戦カードと、実際に検知した TikTok バトルの照合。純粋関数のみ。
//
// **照合は roomId の集合で行う。** バトルの payload から相手の TikTok ハンドルを取る方法が
// 事実上ないため(tiktok-live-connector の anchorInfo は uniqueId を持たず、userId と
// displayId しか出ない)。イベント参加者は全員 monitorUntil で監視しているので、
// 1つのバトルについて両サイドの room から同じ battleId のイベントが届く。
// それを集めれば「そのバトルに誰が参加したか」が payload の解釈精度に依存せず分かる。
//
// **対戦カードは個別の時間枠を持たない。** 割り当てられた開催日程まるごとが対象で、
// 「その日程の中で**終了した**バトル」だけが候補になる(日程の終わりをまたいで終わった
// バトルはどのカードにも付かない)。時間枠が対戦どうしを分離していた前提が無くなったぶん、
// 曖昧さは自動確定を諦める方向で吸収する(下の `autoConfirm` / `reviewReason`)。

export type MatchCandidate = {
  id: string;
  /** 並びを決定的にするためだけに使う(同点のタイブレーク) */
  round: number;
  bracketPosition: number;
  /** 割り当てられた開催日程の [start, end)。この中で終了したバトルだけが候補になる */
  sessionStart: Date;
  sessionEnd: Date;
  /** サイドごとの参加者 roomId。1vs1 なら [[a],[b]]、2vs2 なら [[a1,a2],[b1,b2]] */
  sideRoomIds: string[][];
  /**
   * 不戦勝行(`EventMatch.rules.bye`)。バトルが起きないので検知にも NO_SHOW にも関わらせない。
   *
   * optional にしない — 内部型なので、呼び出し側が渡し忘れたら型で気づけるほうがよい。
   */
  isBye: boolean;
  /**
   * 上流(feeder)の対戦が決着した時刻。**これより前に始まったバトルは候補にしない。**
   * 日程まるごとが対象になったことで、2回戦のカードが埋まった瞬間に「同じ組み合わせで
   * 前に行われたバトル(1回戦・練習)」まで候補に入ってしまうのを防ぐ。null なら制約なし。
   */
  feederDecidedAt: Date | null;
  /**
   * すでに確定している検知。主催者が「検知をやり直す」まで動かさない。
   * これが入っているマッチは、その battleId 以外を候補にしない。
   */
  lockedBattleId: string | null;
};

export type BattleObservation = {
  battleId: string;
  /** その battleId を観測した room。イベント参加者のぶんだけ入る */
  rooms: {
    roomId: string;
    startedAt: Date;
    /** 開始が推定値(途中接続で OPEN を観測できなかった)か */
    startedAtEstimated: boolean;
    endedAt: Date | null;
    /** OPEN と FINISH/CUT_SHORT の両方を観測したか */
    complete: boolean;
    /** BattleSetting.duration(秒)。取れていなければ null */
    durationSec: number | null;
  }[];
};

/**
 * 終了が未確定のバトルを暫定で関連づけてよい下限。日程の開始からこれだけ前まで遡る。
 *
 * **下限なしにすると、ずっと前に始まって終了を観測できなかった過去のバトルが、
 * 日程が始まった瞬間に「進行中」として載る**(`DetectedBattle` は永続テーブルなので
 * room ごとの古い行がいつまでも残る)。取り込みの猶予と同じ幅に揃えてある。
 */
export const PENDING_START_GRACE_MS = 60 * 60 * 1000;

/**
 * 終了時刻の出所。**予定終了時刻へのフォールバックは廃止した** —
 * 実測できない終了時刻をでっち上げると、その区間ぶんの通常ギフトまで
 * バトル倍率と勝敗の集計に混ざる。
 */
export type EndedAtSource = "observed" | "duration";

/** 自動確定しない理由。管理画面のカードに出す。 */
export type ReviewReason =
  /** 観測した room が対戦カードの一部でしかない */
  | "PARTIAL"
  /** 2vs2。room の和集合ではサイドの組み分けを検証できない */
  | "TEAM_BATTLE"
  /** 同じ組み合わせの候補が複数ある(再戦・練習バトル) */
  | "AMBIGUOUS"
  /** 日程が終わっても終了を観測できなかった */
  | "END_UNKNOWN";

/**
 * 主催者が決めた結果、または対戦なしで決まった結果。**自動集計で上書きしない。**
 *
 * - MANUAL: 主催者が勝者を確定した
 * - DRAW:   主催者が引き分けとして確定した(デスマッチのみ)
 * - BYE:    不戦勝。バトルは起きていない
 */
export const MANUAL_DECISIONS = new Set(["MANUAL", "DRAW", "BYE"]);

export type MatchAssignment = {
  matchId: string;
  battleId: string;
  startedAt: Date;
  /**
   * 終了時刻。**null は「まだ終了を観測できていない暫定の関連」。**
   * 暫定のあいだは勝敗もバトル倍率も出さない(`detectedEndAt` を null のまま保存する)。
   */
  endedAt: Date | null;
  /** 終了時刻を何から決めたか。暫定のあいだは null */
  endedAtSource: EndedAtSource | null;
  /**
   * exact  = 観測した room の集合が対戦カードと完全に一致した
   * partial = 一部の room しか観測できなかったが、日程内で候補が1つだけだった
   *           (相手がイベント参加者でない、片側の監視が落ちていた等)
   */
  confidence: "exact" | "partial";
  /**
   * 主催者の確認なしに勝敗を確定してよいか。
   *
   * **終了が確定した 1vs1 の完全一致で、かつ候補が一意のときだけ true。** それ以外は
   * room の集合だけでは実際の対戦が対戦カードどおりだったと言い切れない:
   *
   * - partial: 予定が A 対 B のとき、A が部外者と戦っても観測は {A} になる
   * - 2vs2 の exact: 予定 [A,B] 対 [C,D] と、実際の [A,C] 対 [B,D] は
   *   room の和集合が同じなので区別できない
   * - 候補が複数: 同じ組み合わせが日程内で2回battleしている(再戦・やり直し)
   */
  autoConfirm: boolean;
  /** autoConfirm が false の理由。true のときは null */
  reviewReason: ReviewReason | null;
};

function summarize(battle: BattleObservation) {
  // 同じバトルでも room ごとに受信時刻がずれるので、最も早い開始と最も遅い終了を採る。
  let startedAt = battle.rooms[0].startedAt;
  let endedAt: Date | null = null;
  let durationSec: number | null = null;
  let complete = false;
  // **1つでも実際に OPEN を観測した room があれば、開始は推定値ではない。**
  let startObserved = false;

  for (const room of battle.rooms) {
    if (room.startedAt < startedAt) startedAt = room.startedAt;
    if (room.endedAt && (!endedAt || room.endedAt > endedAt)) endedAt = room.endedAt;
    if (room.durationSec != null && durationSec == null) durationSec = room.durationSec;
    if (room.complete) complete = true;
    if (!room.startedAtEstimated) startObserved = true;
  }

  return {
    startedAt,
    startObserved,
    endedAt,
    durationSec,
    complete,
    rooms: new Set(battle.rooms.map((r) => r.roomId)),
  };
}

/**
 * 実測できる終了時刻。**推測しない** — 観測した終了イベントか、TikTok が申告した
 * バトル長からしか作らない。どちらも無いバトルは「まだ終わっていない」として扱う。
 */
function resolveEndedAt(summary: {
  startedAt: Date;
  startObserved: boolean;
  endedAt: Date | null;
  durationSec: number | null;
}): { endedAt: Date; source: EndedAtSource } | null {
  if (summary.endedAt) return { endedAt: summary.endedAt, source: "observed" };
  // **開始が推定値のときは duration から終了を作らない。** 途中接続で「気づいた時刻」に
  // バトル長を足しても実際の終了にはならず、日程内外の判定を誤らせる。
  if (summary.durationSec != null && summary.startObserved) {
    return {
      endedAt: new Date(summary.startedAt.getTime() + summary.durationSec * 1000),
      source: "duration",
    };
  }
  return null;
}

function isSubset(sub: Set<string>, sup: Set<string>): boolean {
  for (const v of sub) if (!sup.has(v)) return false;
  return true;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && isSubset(a, b);
}

/** 1vs1(各サイドがちょうど1room)か。自動確定してよいのはこの形の完全一致だけ。 */
function isOneOnOne(match: MatchCandidate): boolean {
  return match.sideRoomIds.length === 2 && match.sideRoomIds.every((side) => side.length === 1);
}

type Summary = ReturnType<typeof summarize> & { battleId: string };

type Pair = {
  match: MatchCandidate;
  summary: Summary;
  confidence: "exact" | "partial";
  /** 終了が確定していれば実測値。null は進行中(暫定関連) */
  end: { endedAt: Date; source: EndedAtSource } | null;
};

/** マッチの並び。表の順序を正として決定的にする(同点でも結果が揺れないように)。 */
function compareMatches(a: MatchCandidate, b: MatchCandidate): number {
  if (a.round !== b.round) return a.round - b.round;
  if (a.bracketPosition !== b.bracketPosition) return a.bracketPosition - b.bracketPosition;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** バトルの並び。開始が同時刻なら battleId で決める。 */
function compareSummaries(a: Summary, b: Summary): number {
  const diff = a.startedAt.getTime() - b.startedAt.getTime();
  if (diff !== 0) return diff;
  return a.battleId < b.battleId ? -1 : a.battleId > b.battleId ? 1 : 0;
}

/**
 * 対戦カードと検知したバトルを突き合わせる。
 *
 * - **候補はバトルの終了時刻が日程の `[sessionStart, sessionEnd)` に入るものだけ**。
 *   半開区間なのは、日程の境目のバトルが前後2つの日程の候補にならないようにするため
 * - 終了をまだ観測できていないバトルは「暫定関連」として付ける(`endedAt: null`)。
 *   勝敗もバトル倍率も出さないまま、次の周回で確定を待つ
 * - すでに確定した検知(`lockedBattleId`)はその battleId 以外に動かさない
 * - 上流の決着より前に始まったバトルは候補にしない(`feederDecidedAt`)
 * - 観測 room の集合が対戦カードと完全一致すれば exact、部分集合なら候補が唯一のときだけ partial
 * - 1つのバトルを複数のマッチに、1つのマッチに複数のバトルを割り当てない
 * - 割り当てても、`autoConfirm` が false のものは主催者の確認を挟む
 *
 * **途中終了(CUT_SHORT)したバトルの除外はここでやらない。** 呼び出し側(`battles.ts` の
 * `detectMatches`)が `battles` の母集団から丸ごと外して渡す。ここに条件を足すと、
 * `AMBIGUOUS` の母数や `usedBattles` の取り合いに除外したはずのバトルが残ってしまう。
 */
export function assignBattles(input: {
  matches: MatchCandidate[];
  battles: BattleObservation[];
}): MatchAssignment[] {
  const summaries: Summary[] = input.battles
    .filter((b) => b.rooms.length > 0)
    .map((b) => ({ battleId: b.battleId, ...summarize(b) }))
    .sort(compareSummaries);

  const matches = [...input.matches].sort(compareMatches);
  const expected = new Map(matches.map((m) => [m.id, new Set(m.sideRoomIds.flat())]));

  const pairs: Pair[] = [];
  for (const match of matches) {
    // **両サイドの出場者が確定していない枠は候補にしない。** `expected` は全サイドの
    // 和集合なので、`[["roomA"], []]` だと `{roomA}` として残り、上流の勝者が片方しか
    // 決まっていない枠に「その1人が部外者と戦ったバトル」が完全一致で載ってしまう。
    if (!isReadyForDetection(match)) continue;
    const want = expected.get(match.id)!;

    for (const summary of summaries) {
      // 確定済みの検知は、その battleId だけを見る。
      if (match.lockedBattleId && summary.battleId !== match.lockedBattleId) continue;
      // 上流が決着する前・同時に始まったバトルは、この対戦のものではありえない。
      if (match.feederDecidedAt && summary.startedAt <= match.feederDecidedAt) continue;
      if (!isSubset(summary.rooms, want)) continue;

      const end = resolveEndedAt(summary);
      if (end) {
        // 「日程の中で終了した」バトルだけ。開始が日程より前でも、終わりが中なら対象。
        if (end.endedAt < match.sessionStart) continue;
        if (end.endedAt >= match.sessionEnd) continue;
      } else {
        // 終了が未確定。日程の中(前後の猶予つき)で始まったものだけ暫定で見る。
        if (summary.startedAt >= match.sessionEnd) continue;
        if (summary.startedAt.getTime() < match.sessionStart.getTime() - PENDING_START_GRACE_MS) {
          continue;
        }
      }

      pairs.push({
        match,
        summary,
        confidence: sameSet(summary.rooms, want) ? "exact" : "partial",
        end,
      });
    }
  }

  const usedMatches = new Set<string>();
  const usedBattles = new Set<string>();
  const assignments: MatchAssignment[] = [];

  const take = (pair: Pair, reason: ReviewReason | null) => {
    const oneOnOne = isOneOnOne(pair.match);
    const resolved = pair.end !== null;
    const reviewReason: ReviewReason | null = !resolved
      ? null // 暫定関連はまだ確認を求める段階ではない(終了を待っている)
      : (reason ??
        (pair.confidence === "partial" ? "PARTIAL" : !oneOnOne ? "TEAM_BATTLE" : null));

    assignments.push({
      matchId: pair.match.id,
      battleId: pair.summary.battleId,
      startedAt: pair.summary.startedAt,
      endedAt: pair.end?.endedAt ?? null,
      endedAtSource: pair.end?.source ?? null,
      confidence: pair.confidence,
      autoConfirm: resolved && pair.confidence === "exact" && oneOnOne && reviewReason === null,
      reviewReason,
    });
    usedMatches.add(pair.match.id);
    usedBattles.add(pair.summary.battleId);
  };

  const free = (pair: Pair) =>
    !usedMatches.has(pair.match.id) && !usedBattles.has(pair.summary.battleId);

  // 1) 終了が確定した完全一致。候補が一意でないものは付けるが自動確定しない。
  const resolvedExact = pairs.filter((p) => p.end !== null && p.confidence === "exact");
  const exactByMatch = countBy(resolvedExact, (p) => p.match.id);
  const exactByBattle = countBy(resolvedExact, (p) => p.summary.battleId);

  for (const pair of resolvedExact) {
    if (!free(pair)) continue;
    const ambiguous =
      (exactByMatch.get(pair.match.id) ?? 0) > 1 ||
      (exactByBattle.get(pair.summary.battleId) ?? 0) > 1;
    take(pair, ambiguous ? "AMBIGUOUS" : null);
  }

  // 2) 終了が確定した部分一致。曖昧さが残らないものだけ。
  const resolvedPartial = pairs.filter(
    (p) => p.end !== null && p.confidence === "partial" && free(p)
  );
  for (const pair of resolvedPartial) {
    if (!free(pair)) continue;
    if (hasCompetitor(resolvedPartial, pair, usedMatches, usedBattles)) continue;
    take(pair, "PARTIAL");
  }

  // 3) 進行中(終了未確定)の完全一致だけを暫定で関連づける。
  //    部分一致まで暫定で付けると、部外者とのバトルが LIVE として表に出てしまう。
  const pendingExact = pairs.filter((p) => p.end === null && p.confidence === "exact" && free(p));
  for (const pair of pendingExact) {
    if (!free(pair)) continue;
    if (hasCompetitor(pendingExact, pair, usedMatches, usedBattles)) continue;
    take(pair, null);
  }

  return assignments;
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** 同じバトル/同じマッチを狙う別の候補が残っているか。残っていれば決め打ちしない。 */
function hasCompetitor(
  pool: Pair[],
  pair: Pair,
  usedMatches: Set<string>,
  usedBattles: Set<string>
): boolean {
  return pool.some(
    (other) =>
      other !== pair &&
      !usedMatches.has(other.match.id) &&
      !usedBattles.has(other.summary.battleId) &&
      ((other.summary.battleId === pair.summary.battleId && other.match.id !== pair.match.id) ||
        (other.match.id === pair.match.id && other.summary.battleId !== pair.summary.battleId))
  );
}

/**
 * 日程が終わったのに検知できなかったマッチを返す(NO_SHOW 候補)。
 * 主催者はここから手動で勝者を確定するか、無効にする。
 *
 * **検知の対象になっていない枠は NO_SHOW にしない**(`assignBattles` と同じ述語を使う)。
 * 上流の勝者がまだ決まっていない枠や不戦勝行は「実施されなかった」のではなく
 * 「まだ出場者が決まっていない」だけで、日程を過ぎたからと NO_SHOW にすると、
 * 過去の日程に割り当てた表が作った直後に全滅する。
 */
export function findMissedMatches(input: {
  matches: MatchCandidate[];
  assigned: Set<string>;
  now: Date;
}): string[] {
  return input.matches
    .filter((m) => isReadyForDetection(m))
    .filter((m) => !input.assigned.has(m.id) && m.sessionEnd < input.now)
    .map((m) => m.id);
}

/**
 * TikTok 側の hostScore と、当サービスが gifts から集計したダイヤの乖離を見る。
 *
 * 勝敗は必ず当サービスの集計で決める(集計の出所を1つに揃えるため)が、
 * 大きく食い違っていたらギフトの取りこぼしを疑う材料になるので主催者に警告を出す。
 *
 * **サイド単位では比較できない。** `hostScores` のキーは anchorIdStr(TikTok の数値 userId)で、
 * event 側は参加者の数値 userId を持っていないため、どちらのサイドのスコアか分からない。
 * バトル全体の合計どうしで比べること。
 */
export function scoreDivergence(
  ourDiamonds: bigint,
  tiktokHostScore: string | null | undefined,
  thresholdRatio = 0.1
): { diverged: boolean; ratio: number | null } {
  if (tiktokHostScore == null || tiktokHostScore === "") return { diverged: false, ratio: null };

  const theirs = Number(tiktokHostScore);
  if (!Number.isFinite(theirs) || theirs <= 0) return { diverged: false, ratio: null };

  const ours = Number(ourDiamonds);
  const ratio = Math.abs(ours - theirs) / theirs;
  return { diverged: ratio > thresholdRatio, ratio };
}
