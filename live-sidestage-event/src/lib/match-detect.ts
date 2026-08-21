// 主催者が組んだ対戦カードと、実際に検知した TikTok バトルの照合。純粋関数のみ。
//
// **照合は roomId の集合で行う。** バトルの payload から相手の TikTok ハンドルを取る方法が
// 事実上ないため(tiktok-live-connector の anchorInfo は uniqueId を持たず、userId と
// displayId しか出ない)。イベント参加者は全員 monitorUntil で監視しているので、
// 1つのバトルについて両サイドの room から同じ battleId のイベントが届く。
// それを集めれば「そのバトルに誰が参加したか」が payload の解釈精度に依存せず分かる。

export type MatchCandidate = {
  id: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  /** サイドごとの参加者 roomId。1vs1 なら [[a],[b]]、2vs2 なら [[a1,a2],[b1,b2]] */
  sideRoomIds: string[][];
};

export type BattleObservation = {
  battleId: string;
  /** その battleId を観測した room。イベント参加者のぶんだけ入る */
  rooms: {
    roomId: string;
    startedAt: Date;
    endedAt: Date | null;
    /** OPEN と FINISH/CUT_SHORT の両方を観測したか */
    complete: boolean;
    /** BattleSetting.duration(秒)。取れていなければ null */
    durationSec: number | null;
  }[];
};

export type EndedAtSource = "observed" | "duration" | "scheduled";

export type MatchAssignment = {
  matchId: string;
  battleId: string;
  startedAt: Date;
  endedAt: Date;
  /** 終了時刻を何から決めたか。EventMatch.detectedEndSource に残して後から検証できるようにする */
  endedAtSource: EndedAtSource;
  /**
   * exact  = 観測した room の集合が対戦カードと完全に一致した
   * partial = 一部の room しか観測できなかったが、時間枠内で候補が1つだけだった
   *           (相手がイベント参加者でない、片側の監視が落ちていた等)
   */
  confidence: "exact" | "partial";
  /**
   * 主催者の確認なしに勝敗を確定してよいか。
   *
   * **1vs1 の完全一致だけが true。** それ以外は room の集合だけでは実際の対戦が
   * 対戦カードどおりだったと言い切れない:
   *
   * - partial: 予定が A 対 B のとき、A が部外者と戦っても観測は {A} になる。
   *   これは唯一の候補として通ってしまうので、自動確定させない
   * - 2vs2 の exact: 予定 [A,B] 対 [C,D] と、実際の [A,C] 対 [B,D] は
   *   room の和集合が同じなので区別できない。サイドの構成を payload から
   *   検証する手段(teamUsers 等)が実 payload で確認できるまでは確定させない
   */
  autoConfirm: boolean;
};

function summarize(battle: BattleObservation) {
  // 同じバトルでも room ごとに受信時刻がずれるので、最も早い開始と最も遅い終了を採る。
  let startedAt = battle.rooms[0].startedAt;
  let endedAt: Date | null = null;
  let durationSec: number | null = null;
  let complete = false;

  for (const room of battle.rooms) {
    if (room.startedAt < startedAt) startedAt = room.startedAt;
    if (room.endedAt && (!endedAt || room.endedAt > endedAt)) endedAt = room.endedAt;
    if (room.durationSec != null && durationSec == null) durationSec = room.durationSec;
    if (room.complete) complete = true;
  }

  return {
    startedAt,
    endedAt,
    durationSec,
    complete,
    rooms: new Set(battle.rooms.map((r) => r.roomId)),
  };
}

function resolveEndedAt(
  summary: { startedAt: Date; endedAt: Date | null; durationSec: number | null },
  match: MatchCandidate
): { endedAt: Date; source: EndedAtSource } {
  if (summary.endedAt) return { endedAt: summary.endedAt, source: "observed" };
  if (summary.durationSec != null) {
    return {
      endedAt: new Date(summary.startedAt.getTime() + summary.durationSec * 1000),
      source: "duration",
    };
  }
  return { endedAt: match.scheduledEndAt, source: "scheduled" };
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

/**
 * 対戦カードと検知したバトルを突き合わせる。
 *
 * - `startedAt` が `[scheduledStartAt, scheduledEndAt)` の**半開区間**に入ることが前提。
 *   終端をちょうど跨ぐバトルが前後2つの枠の候補になるのを避ける
 *   (期間の扱いはイベントの集計規則と揃える)
 * - 観測 room の集合が対戦カードの room 集合と完全一致すれば exact
 * - 部分集合でしかない場合は、その組み合わせが時間枠内で唯一のときだけ partial として採る
 *   (複数候補があるなら決め打ちせず、主催者の手動確定に回す)
 * - 1つのバトルを複数のマッチに割り当てない。1つのマッチに複数のバトルも割り当てない
 * - 割り当てても、`autoConfirm` が false のものは主催者の確認を挟む
 */
export function assignBattles(input: {
  matches: MatchCandidate[];
  battles: BattleObservation[];
}): MatchAssignment[] {
  const summaries = input.battles
    .filter((b) => b.rooms.length > 0)
    .map((b) => ({ battleId: b.battleId, ...summarize(b) }));

  const expected = new Map(
    input.matches.map((m) => [m.id, new Set(m.sideRoomIds.flat())])
  );

  type Pair = {
    match: MatchCandidate;
    summary: (typeof summaries)[number];
    confidence: "exact" | "partial";
    distanceMs: number;
  };

  const pairs: Pair[] = [];
  for (const match of input.matches) {
    const want = expected.get(match.id)!;
    if (want.size === 0) continue;

    for (const summary of summaries) {
      if (summary.startedAt < match.scheduledStartAt) continue;
      if (summary.startedAt >= match.scheduledEndAt) continue;
      if (!isSubset(summary.rooms, want)) continue;

      pairs.push({
        match,
        summary,
        confidence: sameSet(summary.rooms, want) ? "exact" : "partial",
        distanceMs: Math.abs(summary.startedAt.getTime() - match.scheduledStartAt.getTime()),
      });
    }
  }

  const usedMatches = new Set<string>();
  const usedBattles = new Set<string>();
  const assignments: MatchAssignment[] = [];

  const take = (pair: Pair) => {
    const { endedAt, source } = resolveEndedAt(pair.summary, pair.match);
    assignments.push({
      matchId: pair.match.id,
      battleId: pair.summary.battleId,
      startedAt: pair.summary.startedAt,
      endedAt,
      endedAtSource: source,
      confidence: pair.confidence,
      autoConfirm: pair.confidence === "exact" && isOneOnOne(pair.match),
    });
    usedMatches.add(pair.match.id);
    usedBattles.add(pair.summary.battleId);
  };

  // 完全一致を先に確定させる。同点は予定開始時刻に近い順。
  const exact = pairs
    .filter((p) => p.confidence === "exact")
    .sort((a, b) => a.distanceMs - b.distanceMs);
  for (const pair of exact) {
    if (usedMatches.has(pair.match.id) || usedBattles.has(pair.summary.battleId)) continue;
    take(pair);
  }

  // 部分一致は曖昧さが残らないものだけ。候補が複数あるバトル・マッチには触らない。
  const partial = pairs.filter(
    (p) =>
      p.confidence === "partial" &&
      !usedMatches.has(p.match.id) &&
      !usedBattles.has(p.summary.battleId)
  );

  for (const pair of partial) {
    if (usedMatches.has(pair.match.id) || usedBattles.has(pair.summary.battleId)) continue;

    const otherMatchesForBattle = partial.filter(
      (p) => p.summary.battleId === pair.summary.battleId && p.match.id !== pair.match.id
    );
    const otherBattlesForMatch = partial.filter(
      (p) => p.match.id === pair.match.id && p.summary.battleId !== pair.summary.battleId
    );
    if (otherMatchesForBattle.length > 0 || otherBattlesForMatch.length > 0) continue;

    take(pair);
  }

  return assignments;
}

/**
 * 対戦カードの時間枠を過ぎたのに検知できなかったマッチを返す(NO_SHOW 候補)。
 * 主催者はここから手動で勝者を確定するか、無効にする。
 */
export function findMissedMatches(input: {
  matches: MatchCandidate[];
  assigned: Set<string>;
  now: Date;
}): string[] {
  return input.matches
    .filter((m) => !input.assigned.has(m.id) && m.scheduledEndAt < input.now)
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
