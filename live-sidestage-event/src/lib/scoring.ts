// スコア計算。すべて純粋関数にしてテストで固定する。
//
// ポイント = ダイヤ実数 × 倍率。**1件のギフトに適用される倍率は必ず1つ**で、
// 合計も乗算もしない(この規則は README と CLAUDE.md にも書いてある)。
//
// 倍率はギフトの受信時刻に依存するので、ギフトを1件ずつ JS に載せるのではなく、
// 先に「重ならない時間区間 + その区間の倍率」を作り、区間ごとに DB 側で集約する。
// 区間の数がそのままクエリの本数になるので、同じ倍率の隣接区間はマージする。

/** 倍率は Decimal(6,2)。丸め誤差を避けるため 100倍した整数(bigint)で持ち回る。 */
export const FACTOR_SCALE = 100n;

export type MultiplierInput = {
  kind: string; // "BATTLE" | "SOLO_STREAM"
  factor: string | number; // Decimal(6,2)
  startAt: Date | null;
  endAt: Date | null;
};

export type TimeRange = { start: Date; end: Date };

export type RateSegment = {
  start: Date;
  end: Date;
  /** 100倍された倍率。等倍なら 100n */
  scaledFactor: bigint;
};

/**
 * Decimal(6,2) 相当の倍率を 100倍の整数にする。"2.5" → 250n
 * 小数第3位以下は切り捨てる(DB 側が Decimal(6,2) なので存在しないはず)。
 */
export function factorToScaled(factor: string | number): bigint {
  const raw = typeof factor === "number" ? factor.toFixed(2) : String(factor).trim();
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(raw);
  if (!m) {
    throw new Error(`倍率の形式が不正: ${raw}`);
  }
  const [, sign, int, frac = ""] = m;
  const scaled = BigInt(int) * FACTOR_SCALE + BigInt((frac + "00").slice(0, 2));
  return sign === "-" ? -scaled : scaled;
}

/**
 * ダイヤ実数に倍率を適用する。返り値は **100倍されたポイント**。
 * bigint のまま計算するので、number の精度(2^53)に依存しない。
 */
export function scaledPoints(diamonds: bigint, scaledFactor: bigint): bigint {
  return diamonds * scaledFactor;
}

/** 100倍されたポイントを Decimal 列に入れる文字列にする。25050n → "250.50" */
export function formatScaledPoints(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const int = abs / FACTOR_SCALE;
  const frac = abs % FACTOR_SCALE;
  return `${negative ? "-" : ""}${int}.${frac.toString().padStart(2, "0")}`;
}

function clampRanges(ranges: TimeRange[], start: Date, end: Date): TimeRange[] {
  const out: TimeRange[] = [];
  for (const r of ranges) {
    const s = r.start < start ? start : r.start;
    const e = r.end > end ? end : r.end;
    if (s < e) out.push({ start: s, end: e });
  }
  return out;
}

function covers(range: { startAt: Date | null; endAt: Date | null }, at: Date): boolean {
  if (range.startAt && at < range.startAt) return false;
  if (range.endAt && at >= range.endAt) return false;
  return true;
}

/**
 * イベント期間を、倍率が一定な区間へ分解する。
 *
 * - 出力区間は `[eventStart, eventEnd)` を隙間なく覆い、互いに重ならない
 * - ある時刻が `battleRanges` に入るなら kind="BATTLE" の倍率、入らないなら "SOLO_STREAM" の倍率
 * - 同じ kind が複数該当したら**最大の factor を1つだけ**採る(合計も乗算もしない)
 * - 該当する倍率がなければ等倍(100n)
 * - `startAt`/`endAt` が null の倍率はイベント全期間に効く
 *
 * `battleRanges` はフェーズ4(バトルトーナメント)で使う。**バトルは配信者ごとに起きるので、
 * イベント全体で1本のリストを渡してはいけない** — 1人がバトル中というだけで同時刻の他の
 * 参加者にまで BATTLE 倍率がかかってしまう。参加者(room)ごとにこの関数を呼び直し、
 * その参加者のバトル区間だけを渡すこと。
 * フェーズ3では常に空なので、実質 SOLO_STREAM の倍率だけが効く。
 */
export function buildRateSegments(input: {
  eventStart: Date;
  eventEnd: Date;
  multipliers: MultiplierInput[];
  battleRanges?: TimeRange[];
}): RateSegment[] {
  const { eventStart, eventEnd } = input;
  if (eventStart >= eventEnd) return [];

  const battles = clampRanges(input.battleRanges ?? [], eventStart, eventEnd);

  // 倍率が変わりうる時刻をすべて境界として集める。
  const boundaries = new Set<number>([eventStart.getTime(), eventEnd.getTime()]);
  for (const m of input.multipliers) {
    for (const t of [m.startAt, m.endAt]) {
      if (t && t > eventStart && t < eventEnd) boundaries.add(t.getTime());
    }
  }
  for (const b of battles) {
    if (b.start > eventStart && b.start < eventEnd) boundaries.add(b.start.getTime());
    if (b.end > eventStart && b.end < eventEnd) boundaries.add(b.end.getTime());
  }

  const sorted = [...boundaries].sort((a, b) => a - b);

  const segments: RateSegment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = new Date(sorted[i]);
    const end = new Date(sorted[i + 1]);

    // 区間内では倍率が一定なので、開始時刻だけで判定してよい。
    const inBattle = battles.some((b) => start >= b.start && start < b.end);
    const kind = inBattle ? "BATTLE" : "SOLO_STREAM";

    let scaledFactor = FACTOR_SCALE;
    for (const m of input.multipliers) {
      if (m.kind !== kind) continue;
      if (!covers(m, start)) continue;
      const f = factorToScaled(m.factor);
      if (f > scaledFactor) scaledFactor = f;
    }

    // 同じ倍率が続くならクエリを分けない。
    const prev = segments[segments.length - 1];
    if (prev && prev.scaledFactor === scaledFactor && prev.end.getTime() === start.getTime()) {
      prev.end = end;
      continue;
    }
    segments.push({ start, end, scaledFactor });
  }

  return segments;
}

export type RankableRow = { points: bigint; diamonds: bigint };

/**
 * ポイント降順で順位を振る。同点は競技順位(1, 2, 2, 4)。
 * ポイントが同じならダイヤ実数の多い方を上位にし、それも同じなら同順位。
 */
export function assignRanks<T extends RankableRow>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.points !== b.points) return a.points > b.points ? -1 : 1;
    if (a.diamonds !== b.diamonds) return a.diamonds > b.diamonds ? -1 : 1;
    return 0;
  });

  const out: (T & { rank: number })[] = [];
  let rank = 0;
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const prev = sorted[i - 1];
    if (!prev || prev.points !== row.points || prev.diamonds !== row.diamonds) {
      rank = i + 1;
    }
    out.push({ ...row, rank });
  }
  return out;
}
