import { intersectWindows, type EventWindow, type Span } from "./sessions";

// 対戦の検知区間を開催日程で切る規則。**純粋関数**。
//
// 「検知したバトルは日程で切ってから集計する」は `match-results.ts` の `scoreSides()`
// (勝敗確定)と `battles.ts` の `loadBattleRangesByRoom()`(倍率・母集団)にも同じ趣旨の
// コードがある。あちらは勝敗という別の責務を持つので今回は置き換えていない。
// ここは「主催者へ見せる集計区間」を決める1箇所として使う。**規則を変えるときは
// scoreSides と食い違わせないこと** — 食い違うと、モーダルの内訳と順位表・勝敗の
// 数字が合わなくなる。

export type MatchSpanInput = {
  status: string;
  detectedStartAt: Date | null;
  detectedEndAt: Date | null;
};

export type MatchSpanResult =
  /** まだバトルを検知していない */
  | { status: "no-detection" }
  /** 終了を観測できないまま日程が終わった。区間が確定しないので数字を出さない */
  | { status: "no-end" }
  /** 検知区間が開催日程と交差しない(日程を後から動かした場合など) */
  | { status: "no-window" }
  | { status: "ok"; spans: Span[]; provisional: boolean };

/**
 * 対戦の検知区間を、その対戦を行う開催日程で切る。
 *
 * `provisional` は「まだ確定していない区間で数えた」印。UI はこれを見て
 * 「順位表にはまだ反映されていない」と注記する。
 */
export function resolveMatchSpans(
  match: MatchSpanInput,
  windows: EventWindow[],
  now: Date
): MatchSpanResult {
  if (!match.detectedStartAt) return { status: "no-detection" };

  // 終了を観測できていない対戦。**バトル進行中(LIVE)だけ**「今まで」で暫定的に出す。
  // それ以外(END_UNKNOWN で NEEDS_REVIEW になったもの)を now まで数えると、
  // 実質「日程の終端まで」が区間になってバトル外のギフトが丸ごと混ざる。
  if (!match.detectedEndAt && match.status !== "LIVE") return { status: "no-end" };

  // `resolveEndedAt()` は OPEN 時に duration から**将来の**終了時刻を作るので、
  // now で切らないとまだ受け取っていない時間まで区間に入る。
  const rawEnd = match.detectedEndAt ?? now;
  const end = rawEnd > now ? now : rawEnd;

  // duration 由来の終了時刻が過去になった直後も、次の検知周回までは LIVE のまま
  // (終了は推定値)。status も条件に含める。
  const provisional =
    match.status === "LIVE" || match.detectedEndAt === null || match.detectedEndAt > now;

  // 始まった直後で区間が空。日程と交差しようがない。
  if (match.detectedStartAt >= end) return { status: "no-window" };

  const spans = intersectWindows({ start: match.detectedStartAt, end }, windows);
  if (spans.length === 0) return { status: "no-window" };

  return { status: "ok", spans, provisional };
}
