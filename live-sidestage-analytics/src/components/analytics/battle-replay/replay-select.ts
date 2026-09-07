// 再生位置(elapsedMs)から「その瞬間に何を描くか」を決める純関数群。
//
// **描画は elapsedMs の純関数で、累積状態を持たない。** 後方シークと速度変更を
// 特別扱いしないための設計で、ここに `useState` や DOM を持ち込まない。

import {
  REPLAY_BAR_LIFETIME_MS,
  type BattleReplayPayload,
  type ReplayGiftEvent,
  type ReplaySegment,
} from "@/lib/battle-replay-contract";

/** 同一サイドに同時に出すカードの上限。超えたら新しい方を優先する。 */
export const MAX_VISIBLE_CARDS_PER_SIDE = 5;
/** 貢献者ボードに並べる人数。 */
export const MAX_VISIBLE_CONTRIBUTORS = 6;

/**
 * 1枚のカード。**コンボ(`k` が同じイベント群)は1枚に畳む。**
 * `count` は畳んだ後の最終値で、`comboSpanMs` はその連打が終わるまでの時間
 * (オドメーターの送り時間に使う)。
 */
export type ReplayCard = {
  /** 安定キー。再マウントでスライドインが再発火しないよう eventIndex 由来にする。 */
  key: string;
  anchorIndex: number;
  senderIndex: number;
  giftIndex: number;
  startMs: number;
  endMs: number;
  count: number;
  diamonds: number;
  comboSpanMs: number;
  /** `Gift.multiplierValue`。5 = グローブ crit、6 = 金グローブ。 */
  multiplierValue: number | null;
};

/** コンボを畳んだカードの一覧。payload ごとに1回だけ作って使い回す。 */
export function buildCards(payload: BattleReplayPayload): ReplayCard[] {
  const byCombo = new Map<number, ReplayCard>();
  const cards: ReplayCard[] = [];

  payload.giftEvents.forEach((event: ReplayGiftEvent, index) => {
    if (event.k !== null) {
      const existing = byCombo.get(event.k);
      if (existing) {
        // combo の各段は差分(`saveComboGift()` が delta を別行で残す)なので足し込む。
        existing.count += event.c;
        existing.diamonds += event.d;
        existing.comboSpanMs = Math.max(0, event.t - existing.startMs);
        existing.endMs = event.t + REPLAY_BAR_LIFETIME_MS;
        if (event.m !== null) existing.multiplierValue = event.m;
        return;
      }
    }
    const card: ReplayCard = {
      key: `e${index}`,
      anchorIndex: event.a,
      senderIndex: event.s,
      giftIndex: event.g,
      startMs: event.t,
      endMs: event.t + REPLAY_BAR_LIFETIME_MS,
      count: event.c,
      diamonds: event.d,
      comboSpanMs: 0,
      multiplierValue: event.m,
    };
    cards.push(card);
    if (event.k !== null) byCombo.set(event.k, card);
  });

  // **開始時刻の昇順で返す。** 畳み込みは「同じ k の最初のイベントが最古」であることに
  // 依存していて、以降の `contributorsAt` 等もこの並びを前提にする。サーバーは現状 `t` 昇順で
  // 返すが、その保証が崩れたときに静かに壊れないよう、ここでも整列しておく。
  return cards.sort((a, b) => a.startMs - b.startMs);
}

/** その瞬間に出ているカード。anchor ごとに新しい順で上限まで。 */
export function cardsAt(cards: ReplayCard[], elapsedMs: number): ReplayCard[] {
  return cards.filter((card) => card.startMs <= elapsedMs && elapsedMs < card.endMs);
}

/** 枠(anchor)ごとに束ね、上限を超えたぶんは古い方から落とす。 */
export function cardsByAnchor(
  visible: ReplayCard[],
  anchorCount: number
): ReplayCard[][] {
  const buckets: ReplayCard[][] = Array.from({ length: anchorCount }, () => []);
  for (const card of visible) {
    const bucket = buckets[card.anchorIndex];
    if (bucket) bucket.push(card);
  }
  return buckets.map((bucket) =>
    bucket.sort((a, b) => a.startMs - b.startMs).slice(-MAX_VISIBLE_CARDS_PER_SIDE)
  );
}

/**
 * コンボの現在値。`×1` から最終値まで、連打の刻みに合わせて上がる。
 * `comboSpanMs` が 0(単発)なら常に最終値。
 */
export function comboCountAt(card: ReplayCard, elapsedMs: number): number {
  if (card.comboSpanMs <= 0 || card.count <= 1) return card.count;
  const ratio = (elapsedMs - card.startMs) / card.comboSpanMs;
  if (ratio >= 1) return card.count;
  return Math.max(1, Math.min(card.count, Math.floor(ratio * card.count) + 1));
}

/**
 * anchor ごとの現在スコア。**補間しない**(公式スコアは階段関数)。
 * `scorePoints` は `t` 昇順なので二分探索で `t <= elapsedMs` の最後の点を採る。
 */
export function scoresAt(payload: BattleReplayPayload, elapsedMs: number): string[] {
  const latest: string[] = payload.anchors.map(() => "0");
  const points = payload.scorePoints;
  let lo = 0;
  let hi = points.length - 1;
  let cut = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= elapsedMs) {
      cut = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  for (let i = 0; i <= cut; i++) {
    const point = points[i]!;
    latest[point.a] = point.s;
  }
  return latest;
}

export type ReplayContributor = {
  senderIndex: number;
  coins: number;
  /** 直近のギフトの受け取り先(リップルの色をその陣営色にする)。 */
  anchorIndex: number;
  /** そのリスナーのカードが今出ているか。 */
  gifting: boolean;
  /** 最後にコインが動いた時刻(リップル倍率の元になるギフト額と対で使う)。 */
  lastCoins: number;
};

/** その瞬間までの貢献者上位。金額降順、同額は先に出た順。 */
/** ギフトカードが1枚も出ていない区間。自動早送りの対象。 */
export type QuietRange = { startMs: number; endMs: number };

/** これ以上ギフトが途切れたら無風とみなす。短い間はスキップしても体感が変わらないうえ、
 * 早送りの出入りが増えて再生が落ち着かない。 */
export const QUIET_MIN_GAP_MS = 8_000;

/** 次のギフトが出る手前でこれだけ早送りを解除して、等速へ戻ってからカードを迎える。 */
export const QUIET_LEAD_MS = 1_000;

/** 無風区間での追加倍率。ユーザーが選んだ速度に**掛ける**。 */
export const QUIET_SKIP_BOOST = 4;

/** `ranges` から `blockers` と重なる部分を取り除く。 */
function subtractRanges(ranges: QuietRange[], blockers: QuietRange[]): QuietRange[] {
  let result = ranges;
  for (const blocker of blockers) {
    const next: QuietRange[] = [];
    for (const range of result) {
      if (blocker.endMs <= range.startMs || blocker.startMs >= range.endMs) {
        next.push(range);
        continue;
      }
      if (range.startMs < blocker.startMs) next.push({ startMs: range.startMs, endMs: blocker.startMs });
      if (blocker.endMs < range.endMs) next.push({ startMs: blocker.endMs, endMs: range.endMs });
    }
    result = next;
  }
  return result;
}

/**
 * ギフトカードが1枚も出ていない区間を返す。**赤帯が出ている区間は除く** —
 * 倍率区間・ボーナス区間はギフトが無くても見せる価値があり、飛ばすと
 * 「初めてのギフト×N」の帯を見逃す。
 */
export function quietRangesOf(
  payload: BattleReplayPayload,
  cards: ReplayCard[],
  durationMs: number
): QuietRange[] {
  const spans = [...cards].sort((a, b) => a.startMs - b.startMs);
  const gaps: QuietRange[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.startMs - cursor >= QUIET_MIN_GAP_MS) {
      gaps.push({ startMs: cursor, endMs: span.startMs - QUIET_LEAD_MS });
    }
    cursor = Math.max(cursor, span.endMs);
  }
  if (durationMs - cursor >= QUIET_MIN_GAP_MS) gaps.push({ startMs: cursor, endMs: durationMs });

  const bands = payload.segments
    .filter((segment) => isBandSegment(segment))
    .map((segment) => ({ startMs: segment.startMs, endMs: segment.endMs }));

  return subtractRanges(gaps, bands).filter((r) => r.endMs - r.startMs >= QUIET_MIN_GAP_MS);
}

export function isQuietAt(ranges: QuietRange[], elapsedMs: number): boolean {
  return ranges.some((range) => elapsedMs >= range.startMs && elapsedMs < range.endMs);
}

/** `payload.anchors` 上での本人の位置。scorePoints / giftEvents の `a` はこの添字を指す。
 *
 * 個人の `isSelf` が1件も立たないバトル(確定処理が解決できなかった古い行)では、
 * **自陣営全員へフォールバックする**。空集合を返すと貢献者ボードが無言で空になる。 */
export function selfAnchorIndexes(payload: BattleReplayPayload): Set<number> {
  const byParticipant = new Set<number>();
  const byTeam = new Set<number>();
  let index = 0;
  for (const team of payload.teams) {
    for (const participant of team.participants) {
      if (participant.isSelf) byParticipant.add(index);
      if (team.isSelf) byTeam.add(index);
      index += 1;
    }
  }
  return byParticipant.size > 0 ? byParticipant : byTeam;
}

export function contributorsAt(
  payload: BattleReplayPayload,
  cards: ReplayCard[],
  elapsedMs: number,
  limit = MAX_VISIBLE_CONTRIBUTORS
): ReplayContributor[] {
  const totals = new Map<number, ReplayContributor>();
  const giftingSenders = new Set<number>();
  // **本人へのギフトだけを集計する。** 実バトル画面の下段も自分への貢献者一覧で、
  // 全 anchor を合算すると相手陣営のほうが多いバトルで相手の貢献者が並んでしまう。
  const selfAnchors = selfAnchorIndexes(payload);

  for (const card of cards) {
    if (card.startMs > elapsedMs) continue;
    if (!selfAnchors.has(card.anchorIndex)) continue;
    const counted = comboCountAt(card, elapsedMs);
    // combo の途中は、まだ届いていない段のダイヤを足さない。
    const coins =
      card.count > 0 ? Math.floor((card.diamonds * counted) / card.count) : card.diamonds;
    const current = totals.get(card.senderIndex);
    if (current) {
      current.coins += coins;
      current.anchorIndex = card.anchorIndex;
      current.lastCoins = coins;
    } else {
      totals.set(card.senderIndex, {
        senderIndex: card.senderIndex,
        coins,
        anchorIndex: card.anchorIndex,
        gifting: false,
        lastCoins: coins,
      });
    }
    if (elapsedMs < card.endMs) giftingSenders.add(card.senderIndex);
  }

  return [...totals.values()]
    .map((c) => ({ ...c, gifting: giftingSenders.has(c.senderIndex) }))
    .sort((a, b) => b.coins - a.coins || a.senderIndex - b.senderIndex)
    .slice(0, limit);
}

/** カードの太さ。ダイヤ額で決まる(comp の上段=小額/下段=高額の作り分け)。 */
export function cardSizeOf(diamonds: number): "sm" | "md" | "lg" {
  if (diamonds >= 1000) return "lg";
  if (diamonds >= 100) return "md";
  return "sm";
}

/**
 * 帯にしてよい区間か。**初ギフト倍率の推定(`inferred`)は帯にしない**
 * (推定を事実として見せることになる。チップ止まり)。
 */
export function isBandSegment(segment: ReplaySegment): boolean {
  if (segment.kind !== "opening") return true;
  return segment.confidence === "measured";
}

/** その瞬間の帯。重なったら `opening` を優先する。 */
export function segmentAt(
  payload: BattleReplayPayload,
  elapsedMs: number
): ReplaySegment | null {
  const active = payload.segments.filter(
    (s) => s.startMs <= elapsedMs && elapsedMs < s.endMs
  );
  if (active.length === 0) return null;
  return active.find((s) => s.kind === "opening") ?? active[0]!;
}
