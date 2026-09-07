"use client";

import { memo } from "react";
import type { BattleReplayPayload } from "@/lib/battle-replay-contract";
import { resolveWinningTeamIndex } from "../battle-colors";
import { ReplayBand } from "./ReplayBand";
import { ReplayCell } from "./ReplayCell";
import { ReplayGiftCard } from "./ReplayGiftCard";
import { ReplayScoreBar } from "./ReplayScoreBar";
import type { StageLayout } from "./replay-layout";
import {
  cardSizeOf,
  cardsByAnchor,
  cardsAt,
  isBandSegment,
  scoresAt,
  segmentAt,
  type ReplayCard,
} from "./replay-select";

/** anchor ごとの順位(スコア降順、同点は anchor 順)。 */
function ranksOf(scores: string[]): number[] {
  const order = scores
    .map((s, index) => {
      let value = 0n;
      try {
        value = BigInt(s);
      } catch {
        value = 0n;
      }
      return { index, value };
    })
    .sort((a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : a.index - b.index));
  const ranks: number[] = new Array(scores.length).fill(scores.length);
  order.forEach((entry, position) => {
    ranks[entry.index] = position + 1;
  });
  return ranks;
}

export const ReplayStage = memo(function ReplayStage({
  payload,
  layout,
  cards,
  colorByAnchor,
  elapsedMs,
  scoreTransitionMs,
}: {
  payload: BattleReplayPayload;
  layout: StageLayout;
  cards: ReplayCard[];
  colorByAnchor: string[];
  elapsedMs: number;
  /** スコアバーの幅補間時間(ms)。シーク中は 0。 */
  scoreTransitionMs: number;
}) {
  const scores = scoresAt(payload, elapsedMs);
  const ranks = ranksOf(scores);
  const visible = cardsAt(cards, elapsedMs);
  const buckets = cardsByAnchor(visible, payload.anchors.length);
  const segment = segmentAt(payload, elapsedMs);
  const participants = payload.teams.flatMap((team) => team.participants);
  // **勝敗は陣営の officialScore で決める。** anchor 個人の最終スコアで決めると、チーム戦で
  // 「負け陣営の最多貢献メンバー」に WIN が付き、一覧・詳細モーダルの表示と食い違う。
  // 同点は null(バッジを出さない)。
  const winningTeamIndex = resolveWinningTeamIndex(
    payload.teams.map((team) => ({ index: team.index, score: team.officialScore }))
  );
  // **順位バッジは3陣営以上の個人戦だけ。** 1vs1 とチーム戦は勝敗が陣営単位で決まるので、
  // 個人順位を出すと「勝ち陣営の下位メンバー」に負けの見た目が付く(comp と同じ振り分け)。
  const showRank = payload.teams.length >= 3;

  return (
    <div className="replay-stage">
      <ReplayScoreBar
        scores={scores}
        colors={colorByAnchor}
        elapsedMs={elapsedMs}
        transitionMs={scoreTransitionMs}
      />

      {/* レーンはグリッド全体に重ねるので、赤帯を巻き込まないようここで位置基準を作る */}
      <div className="relative">
        <div className={`replay-grid replay-grid--${layout.variant}`}>
          {layout.cells.map((cell) => (
            <ReplayCell
              key={cell.anchorIndex}
              cell={cell}
              participant={participants[cell.anchorIndex]}
              color={colorByAnchor[cell.anchorIndex] ?? "#9a9ea6"}
              score={scores[cell.anchorIndex] ?? "0"}
              rank={showRank ? ranks[cell.anchorIndex] ?? 1 : null}
              isWinner={winningTeamIndex !== null && cell.teamIndex === winningTeamIndex}
              cards={buckets[cell.anchorIndex] ?? []}
              senders={payload.senders}
              gifts={payload.gifts}
              elapsedMs={elapsedMs}
              hideLanes={layout.fullWidthLanes}
            />
          ))}
        </div>

        {layout.fullWidthLanes ? (
          <FullWidthLanes
            payload={payload}
            layout={layout}
            buckets={buckets}
            colorByAnchor={colorByAnchor}
            elapsedMs={elapsedMs}
          />
        ) : null}
      </div>

      {segment && isBandSegment(segment) ? (
        <ReplayBand segment={segment} elapsedMs={elapsedMs} />
      ) : null}
    </div>
  );
});

/** 1vs1 だけステージ全幅の2段レーン(上段=小額、下段=高額)。 */
function FullWidthLanes({
  payload,
  layout,
  buckets,
  colorByAnchor,
  elapsedMs,
}: {
  payload: BattleReplayPayload;
  layout: StageLayout;
  buckets: ReplayCard[][];
  colorByAnchor: string[];
  elapsedMs: number;
}) {
  const tiers: ("sm" | "lg")[] = ["sm", "lg"];
  return (
    <div className="replay-lanes">
      {tiers.map((tier) => (
        <div className="replay-tier" key={tier}>
          {layout.cells.map((cell) => {
            const laneCards = (buckets[cell.anchorIndex] ?? []).filter((card) =>
              tier === "lg" ? cardSizeOf(card.diamonds) === "lg" : cardSizeOf(card.diamonds) !== "lg"
            );
            return (
              <div
                key={cell.anchorIndex}
                className={cell.right ? "replay-lane replay-lane--right" : "replay-lane"}
              >
                {laneCards.map((card) => (
                  <ReplayGiftCard
                    key={card.key}
                    card={card}
                    sender={payload.senders[card.senderIndex]}
                    gift={payload.gifts[card.giftIndex]}
                    color={colorByAnchor[cell.anchorIndex] ?? "#9a9ea6"}
                    mirror={cell.right}
                    opponent={cell.opponentCard}
                    elapsedMs={elapsedMs}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
