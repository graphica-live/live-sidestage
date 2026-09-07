// 「初ギフトx倍」区間の逆算。
//
// TikTok はバトル開始直後の一定時間、ギフトのスコア換算に倍率を掛ける(BATTLE-EVENTS.md 4節)。
// **倍率そのものを配信してこない**ので、スコアの増分とギフトのダイヤ数の比から後追いで推定する。
//
// **DBを引かない純関数にしてある。** 入力は呼び出し側(battle-history-finalize.ts)が既に読んだ
// スコア点・ギフト・ボーナス区間だけで、追加クエリは発生しない。
//
// **多くのバトルで unknown になる前提で使うこと。** 同時多発・combo連打・小粒ギフトでは
// 切り分けられない(BATTLE-EVENTS.md 4節が明記)。逆算できないことは再生可否に影響させない。

/** 候補として見る区間の長さ。**未確定の仮定値。**
 * BATTLE-EVENTS.md 4節の実測は48秒だが、バトル形式ごとの差が未検証なので余裕を持たせている。
 * この値から「残り何秒」を計算して画面に出してはいけない(仮定を事実として見せることになる)。 */
export const OPENING_WINDOW_MS = 60_000;

/** スコア点の直前どこまでのギフトをその増分の原因とみなすか。
 * **armies の occurredAt はサーバー受信時刻、Gift.receivedAt は TikTok の createTime 由来**で
 * 時刻の基準が違う。その差(配送遅延 + 時刻基準のズレ)を吸収するための補正値。
 *
 * 本番実測(n=4838、100ダイヤ以上かつ multiplierType=0 のギフトと、その後6秒以内に
 * `delta >= totalDiamonds` を満たしたスコア点の時間差): p25=1043ms / p50=1533ms / p75=3111ms、
 * 最頻帯は 1000〜1500ms。中央値が 1500 を超えるので、旧値 1500 では正常な反映の半分を
 * 「離れすぎ」として捨てていた。 */
export const GIFT_TO_SCORE_LAG_MS = 3_000;

/** ギフトが区間の終端スコア点のこれだけ手前に届いていたら、その増分が t[i] に出たのか
 * t[i+1] に出たのかを時刻から決められないとみなす。
 *
 * **`GIFT_TO_SCORE_LAG_MS` と兼用してはいけない。** 反映遅延の最頻帯が 1000〜1500ms なので、
 * 曖昧判定にも 1500 を使うと「正常に反映されたケースほど確実に除外される」ことになる
 * (実際それで本番 976 バトル中 774 件が unknown になっていた)。実測の下位5%が 349ms
 * なので、それより内側だけを「速すぎて原因を特定できない」として外す。 */
export const SCORE_ASSIGNMENT_AMBIGUITY_MS = 250;

/** これ未満のギフトは候補にしない。小粒ギフトは1ダイヤの誤差が比を大きく動かすため。 */
export const MIN_CANDIDATE_DIAMONDS = 100;

/** ratio が整数からどれだけ離れてよいか。 */
export const RATIO_TOLERANCE = 0.02;

/** 採用する倍率。4倍以上は観測されていない。x5 は グローブcrit(multiplierType=1)なので別枠。 */
export const ALLOWED_MULTIPLIERS = [1, 2, 3] as const;

export type OpeningScorePoint = {
  anchorId: string;
  occurredAt: Date;
  /** 累積スコア。桁が大きいので文字列で受け、内部で数値化する。 */
  score: string;
};

export type OpeningGift = {
  /** Gift.id。basisGiftId として記録する。 */
  id: string;
  /** **このギフトが加算された配信者。** スコア点は anchor ごとに独立して動くので、
   * 別 anchor のギフトを他人の増分の原因として割り当ててはいけない。 */
  anchorId: string;
  /** Gift.receivedAt(TikTok createTime 由来)。 */
  occurredAt: Date;
  totalDiamonds: number;
  /** **0(倍率なしと観測できた) と null(未観測) を同一視しないこと。**
   * P2 デプロイ前のギフトは全て null で、TOP_2/TOP_3 ブースター(x2)と区別できない。 */
  multiplierType: number | null;
};

/** ボーナスミッションの報酬区間。ここと重なるギフトは倍率が混ざるので候補から外す。 */
export type OpeningBonusInterval = {
  startedAt: Date | null;
  endedAt: Date | null;
};

export type OpeningMultiplierResult = {
  /** 1(倍率なし) / 2 / 3 / null(判定不能)。**1 と null を混同しないこと。** */
  multiplier: number | null;
  confidence: "measured" | "inferred" | "unknown";
  /** 判定に使った最初の候補の Gift.id。unknown なら null。 */
  basisGiftId: string | null;
  /** **実測できた場合のみ非null。** 現状 TikTok は倍率区間の開始・終了を配信しないので常に null。
   * 仮定値(OPENING_WINDOW_MS)からは絶対に埋めない。 */
  windowStartedAt: Date | null;
  windowEndedAt: Date | null;
};

const UNKNOWN: OpeningMultiplierResult = {
  multiplier: null,
  confidence: "unknown",
  basisGiftId: null,
  windowStartedAt: null,
  windowEndedAt: null,
};

function parseScore(value: string): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function overlapsBonus(at: Date, intervals: OpeningBonusInterval[]): boolean {
  const t = at.getTime();
  for (const interval of intervals) {
    const start = interval.startedAt?.getTime();
    const end = interval.endedAt?.getTime();
    if (start === undefined || end === undefined) continue;
    if (t >= start && t <= end) return true;
  }
  return false;
}

type Candidate = { giftId: string; occurredAt: Date; multiplier: number; multiplierObserved: boolean };

/**
 * スコアの増分1つとその原因ギフト1件が1対1に対応する区間だけを拾い、比から倍率を推定する。
 *
 * 判定できる条件を厳しくしてある(区間内のギフトがちょうど1件・100ダイヤ以上・ボーナス区間と
 * 重ならない)。**取りこぼしてよい**代わりに、誤った倍率を「確定」として出さないことを優先する。
 */
export function inferOpeningMultiplier(input: {
  windowStart: Date;
  /** **windowStart がバトルの実際の開始時刻だと信じてよいか**(= TiktokBattle.startedAtEstimated
   * の否定)。配信途中から接続した場合の windowStart は「気づいた時刻」でしかなく、そこから
   * 60秒はバトル中盤の通常ギフト区間になる。そこで ratio=1 が2件そろうと
   * 「倍率なしと判定できた(measured)」を恒久化してしまうので、判定自体を行わない。 */
  windowStartReliable: boolean;
  scorePoints: OpeningScorePoint[];
  gifts: OpeningGift[];
  bonusIntervals: OpeningBonusInterval[];
}): OpeningMultiplierResult {
  if (!input.windowStartReliable) return UNKNOWN;
  const windowStartMs = input.windowStart.getTime();
  const windowEndMs = windowStartMs + OPENING_WINDOW_MS;

  const pointsByAnchor = new Map<string, OpeningScorePoint[]>();
  for (const point of input.scorePoints) {
    const at = point.occurredAt.getTime();
    if (at < windowStartMs || at > windowEndMs) continue;
    const list = pointsByAnchor.get(point.anchorId);
    if (list) list.push(point);
    else pointsByAnchor.set(point.anchorId, [point]);
  }
  if (pointsByAnchor.size === 0) return UNKNOWN;

  const gifts = input.gifts
    .filter((g) => {
      const at = g.occurredAt.getTime();
      return at >= windowStartMs - GIFT_TO_SCORE_LAG_MS && at <= windowEndMs;
    })
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  if (gifts.length === 0) return UNKNOWN;

  const candidates: Candidate[] = [];

  for (const [anchorId, points] of pointsByAnchor) {
    const sorted = [...points].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    // スコア点はこの anchor のものなので、原因になりうるのは同じ anchor 宛のギフトだけ。
    const anchorGifts = gifts.filter((g) => g.anchorId === anchorId);

    // **各ギフトは高々1つの区間へ割り当てる。** 区間を (t[i-1] - lag, t[i]] と素朴に重ねると
    // 隣接区間が lag 分だけ重なり、配送遅延が lag を超えたときに「区間内ちょうど1件」が
    // 誤って成立する。ギフトは occurredAt 以上で最初に来るスコア点へ1回だけ渡す。
    const assigned = new Map<number, typeof gifts>();
    // **反映先が確定できない区間**。ギフトが区間の終端スコア点のごく直前に届いた場合、
    // その増分が t[i] に出たのか t[i+1] に出たのかを時刻からは決められない
    // (armies はサーバー受信時刻、Gift は TikTok の createTime で基準が違う)。
    // どちらへ寄せても比が壊れるので、両方の区間を候補から外す。
    const ambiguous = new Set<number>();
    for (const gift of anchorGifts) {
      const giftAt = gift.occurredAt.getTime();
      const index = sorted.findIndex((p, i) => i > 0 && p.occurredAt.getTime() >= giftAt);
      if (index <= 0) continue;
      // 先頭区間より前(窓の開始点より lag 以上前)のギフトは、その増分の原因とみなすには離れすぎている。
      if (giftAt <= sorted[index - 1].occurredAt.getTime() - GIFT_TO_SCORE_LAG_MS) continue;
      if (sorted[index].occurredAt.getTime() - giftAt < SCORE_ASSIGNMENT_AMBIGUITY_MS) {
        ambiguous.add(index);
        ambiguous.add(index + 1);
      }
      const list = assigned.get(index);
      if (list) list.push(gift);
      else assigned.set(index, [gift]);
    }

    for (const [index, giftsInInterval] of assigned) {
      if (ambiguous.has(index)) continue;
      if (giftsInInterval.length === 0) continue;
      // **区間内のギフトは合算する。** armies の更新間隔は数百ms〜数秒で、その間に複数の
      // ギフトが届くのが普通のため、「区間内ちょうど1件」を要求すると実バトルではほぼ成立せず、
      // 本番 976 バトル中 774 件が unknown になっていた(2026-09-07 実測)。
      // 合算しても、区間内の全ギフトが同じ倍率区間に属する限り比は保たれる。
      // 別の倍率(グローブcrit・TOP_2/TOP_3ブースター)やボーナス区間が1件でも混ざる区間は、
      // 比が壊れるので区間ごと捨てる。
      if (giftsInInterval.some((g) => overlapsBonus(g.occurredAt, input.bonusIntervals))) continue;
      if (giftsInInterval.some((g) => g.multiplierType !== null && g.multiplierType !== 0)) continue;

      const totalDiamonds = giftsInInterval.reduce((sum, g) => sum + g.totalDiamonds, 0);
      if (totalDiamonds < MIN_CANDIDATE_DIAMONDS) continue;

      const before = parseScore(sorted[index - 1].score);
      const after = parseScore(sorted[index].score);
      if (before === null || after === null) continue;
      const delta = after - before;
      if (delta <= 0) continue;

      const ratio = delta / totalDiamonds;
      const rounded = Math.round(ratio);
      if (Math.abs(ratio - rounded) > RATIO_TOLERANCE) continue;
      if (!(ALLOWED_MULTIPLIERS as readonly number[]).includes(rounded)) continue;

      const basis = giftsInInterval[0];
      candidates.push({
        giftId: basis.id,
        occurredAt: basis.occurredAt,
        multiplier: rounded,
        multiplierObserved: giftsInInterval.every((g) => g.multiplierType === 0),
      });
    }
  }

  if (candidates.length === 0) return UNKNOWN;

  const first = candidates.reduce((earliest, c) =>
    c.occurredAt.getTime() < earliest.occurredAt.getTime() ? c : earliest
  );
  const allAgree = candidates.every((c) => c.multiplier === first.multiplier);
  if (!allAgree) return UNKNOWN;

  // **倍率刻印が1件でも未観測なら confidence の上限を inferred に落とす。**
  // P2 デプロイ前のギフトは multiplierType が null で、TOP_2/TOP_3 ブースター(x2)を除外できない。
  // その状態の ratio=2 を "measured" として赤帯に出すと、推定を事実として見せることになる。
  const allObserved = candidates.every((c) => c.multiplierObserved);
  const confidence = candidates.length >= 2 && allObserved ? "measured" : "inferred";

  return {
    multiplier: first.multiplier,
    confidence,
    basisGiftId: first.giftId,
    // 区間の開始・終了は TikTok が配信してこないため実測できない。仮定値からは埋めない。
    windowStartedAt: null,
    windowEndedAt: null,
  };
}
