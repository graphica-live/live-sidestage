// デスマッチのライフポイント計算。純粋関数だけを置く(テスト対象)。
//
// 対戦の検知と勝敗の決め方はトーナメントと完全に共通(battles.ts / match-results.ts)。
// ここは「確定したマッチの結果からライフをいくつ増減させるか」だけを持つ。
//
// **全期間再計算する。** マッチの勝敗は主催者が後から変えられるし VOID にもできるので、
// 増分では直せない。集計本体と同じ思想で毎回作り直して置き換える。

export type DeathmatchRules = {
  /** 開始時のライフ */
  initialLife: number;
  /** 敗北で減る量 */
  lossDelta: number;
  /** 勝利で増える量。0 なら回復なし */
  winDelta: number;
  /** 引き分けで減る量 */
  drawDelta: number;
  /** 回復の上限。null なら initialLife を上限にする */
  maxLife: number | null;
};

export const DEFAULT_DEATHMATCH_RULES: DeathmatchRules = {
  initialLife: 3,
  lossDelta: 1,
  winDelta: 0,
  drawDelta: 0,
  maxLife: null,
};

/** ライフの上限。無制限にすると UI が壊れるので現実的な範囲で止める。 */
export const MAX_LIFE_VALUE = 99;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * `Event.rules` の `deathmatch` キーを読む。
 *
 * イベント作成時に必ず設定させると導線が重いので、**未設定でも既定値でそのまま動く**。
 * 不正な値は既定値へ落とし、例外は投げない(集計を止めないため)。
 */
export function parseDeathmatchRules(rules: unknown): DeathmatchRules {
  const record =
    rules && typeof rules === "object" && !Array.isArray(rules)
      ? ((rules as Record<string, unknown>).deathmatch as Record<string, unknown> | undefined)
      : undefined;
  if (!record || typeof record !== "object") return { ...DEFAULT_DEATHMATCH_RULES };

  const initialLife = clampInt(record.initialLife, 1, MAX_LIFE_VALUE, DEFAULT_DEATHMATCH_RULES.initialLife);
  const rawMax = record.maxLife;
  const maxLife =
    rawMax === null || rawMax === undefined
      ? null
      : clampInt(rawMax, initialLife, MAX_LIFE_VALUE, initialLife);

  return {
    initialLife,
    lossDelta: clampInt(record.lossDelta, 0, MAX_LIFE_VALUE, DEFAULT_DEATHMATCH_RULES.lossDelta),
    winDelta: clampInt(record.winDelta, 0, MAX_LIFE_VALUE, DEFAULT_DEATHMATCH_RULES.winDelta),
    drawDelta: clampInt(record.drawDelta, 0, MAX_LIFE_VALUE, DEFAULT_DEATHMATCH_RULES.drawDelta),
    maxLife,
  };
}

export type LifeOutcome = "WIN" | "LOSS" | "DRAW";

export type LifeEvent = {
  matchId: string;
  /** マッチが決着した時刻。適用順のキー */
  decidedAt: Date;
  results: { subjectId: string; outcome: LifeOutcome }[];
};

export type LedgerEntry = {
  matchId: string;
  delta: number;
  reason: "MATCH_LOSS" | "MATCH_WIN" | "MATCH_DRAW";
  at: Date;
};

export type LifeState = {
  subjectId: string;
  current: number;
  max: number;
  eliminatedAt: Date | null;
  ledger: LedgerEntry[];
};

const REASON_BY_OUTCOME: Record<LifeOutcome, LedgerEntry["reason"]> = {
  WIN: "MATCH_WIN",
  LOSS: "MATCH_LOSS",
  DRAW: "MATCH_DRAW",
};

/**
 * 確定したマッチの結果からライフを計算する。
 *
 * - 全員 `initialLife` から始める
 * - `decidedAt` の昇順に適用する（同時刻は matchId で安定させる）
 * - `current` が 0 になったら脱落
 * - **脱落した出場者が1人でも含まれる対戦は、丸ごと無視する**（相手にも適用しない）
 * - `current` は 0 未満にも `maxLife` 超にもしない
 * - 増減が 0 のイベントは履歴に残さない（ノイズになるため）
 */
export function computeLifePoints(input: {
  subjectIds: string[];
  events: LifeEvent[];
  rules: DeathmatchRules;
}): LifeState[] {
  const { rules } = input;
  const ceiling = rules.maxLife ?? rules.initialLife;

  const states = new Map<string, LifeState>(
    input.subjectIds.map((subjectId) => [
      subjectId,
      {
        subjectId,
        current: rules.initialLife,
        max: ceiling,
        eliminatedAt: null,
        ledger: [],
      },
    ])
  );

  const ordered = [...input.events].sort((a, b) => {
    const diff = a.decidedAt.getTime() - b.decidedAt.getTime();
    if (diff !== 0) return diff;
    // 同時刻の決着は matchId で並べる。再計算のたびに順序が変わらないようにする。
    return a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0;
  });

  for (const event of ordered) {
    // **一人でも脱落していたら、その対戦は成立していないものとして丸ごと無視する。**
    // 脱落した側だけスキップすると相手には WIN が入り、回復ありの設定では
    // 「脱落者と組まれた側だけが得をする」ことになる。対戦カードは脱落前に
    // 予約できるうえ、過去の勝敗を主催者が覆すと出場資格が遡って変わるので、
    // この状況は普通に起きる。
    const hasEliminated = event.results.some((r) => states.get(r.subjectId)?.eliminatedAt);
    if (hasEliminated) continue;

    for (const result of event.results) {
      const state = states.get(result.subjectId);
      if (!state) continue; // 集計中に参加者が外れた場合

      const delta =
        result.outcome === "WIN"
          ? rules.winDelta
          : result.outcome === "LOSS"
            ? -rules.lossDelta
            : -rules.drawDelta;

      const next = Math.min(Math.max(state.current + delta, 0), state.max);
      const applied = next - state.current;
      state.current = next;

      if (applied !== 0) {
        state.ledger.push({
          matchId: event.matchId,
          delta: applied,
          reason: REASON_BY_OUTCOME[result.outcome],
          at: event.decidedAt,
        });
      }

      if (state.current === 0) state.eliminatedAt = event.decidedAt;
    }
  }

  return input.subjectIds.map((id) => states.get(id)!);
}

export type LifeRankable = {
  subjectId: string;
  current: number;
  eliminatedAt: Date | null;
  /** 同ライフのときの比較に使う。BigInt を文字列にしたもの */
  diamonds: string;
};

/**
 * デスマッチの順位。残ライフが多い順、同じなら獲得ダイヤが多い順。
 *
 * 脱落者どうしは**遅く脱落したほうが上**（長く生き残ったため）。
 * `EventStanding.rank`（獲得ダイヤの順位）とは別物なので、混ぜないこと。
 */
export function rankByLife<T extends LifeRankable>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.current !== b.current) return b.current - a.current;

    // どちらも脱落済みなら、遅く落ちたほうが上。
    if (a.eliminatedAt && b.eliminatedAt) {
      const diff = b.eliminatedAt.getTime() - a.eliminatedAt.getTime();
      if (diff !== 0) return diff;
    } else if (a.eliminatedAt) {
      return 1;
    } else if (b.eliminatedAt) {
      return -1;
    }

    return compareDiamonds(b.diamonds, a.diamonds);
  });

  const ranked: (T & { rank: number })[] = [];
  let rank = 0;
  let prev: T | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const sameAsPrev =
      prev !== null &&
      prev.current === row.current &&
      (prev.eliminatedAt?.getTime() ?? null) === (row.eliminatedAt?.getTime() ?? null) &&
      compareDiamonds(prev.diamonds, row.diamonds) === 0;
    if (!sameAsPrev) rank = i + 1;
    ranked.push({ ...row, rank });
    prev = row;
  }
  return ranked;
}

/** BigInt 由来の数値文字列を Number にせず比較する(21億を超えるため)。 */
function compareDiamonds(a: string, b: string): number {
  const av = BigInt(a || "0");
  const bv = BigInt(b || "0");
  return av === bv ? 0 : av > bv ? 1 : -1;
}
