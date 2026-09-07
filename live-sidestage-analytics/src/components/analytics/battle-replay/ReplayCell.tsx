"use client";

import type { ReplayGift, ReplayParticipant, ReplaySender } from "@/lib/battle-replay-contract";
import { GOLD } from "../battle-colors";
import { initialOf, rippleScaleForCoins } from "./replay-format";
import { cellBackground } from "./replay-color";
import type { StageCell } from "./replay-layout";
import type { ReplayCard } from "./replay-select";
import { ReplayGiftCard } from "./ReplayGiftCard";

export function ReplayCell({
  cell,
  participant,
  color,
  score,
  rank,
  isWinner,
  cards,
  senders,
  gifts,
  elapsedMs,
  /** 1vs1 はステージ全幅のレーンを使うので、セル内にはカードを置かない。 */
  hideLanes,
}: {
  cell: StageCell;
  participant: ReplayParticipant | undefined;
  color: string;
  score: string;
  /** 順位バッジ。3陣営以上の個人戦だけ出し、1vs1・チーム戦は null(WIN バッジを使う)。 */
  rank: number | null;
  isWinner: boolean;
  cards: ReplayCard[];
  senders: ReplaySender[];
  gifts: ReplayGift[];
  elapsedMs: number;
  hideLanes: boolean;
}) {
  const name = participant?.displayName ?? "";
  const peak = cards.reduce((max, card) => Math.max(max, card.diamonds), 0);
  const ringCount = peak >= 1000 ? 2 : peak > 0 ? 1 : 0;
  const scoreNumber = (() => {
    try {
      return Number(BigInt(score));
    } catch {
      return 0;
    }
  })();

  // 縦が足りない枠のレーンは名前チップと同じ1行を分け合うので、comp どおり**最新1本だけ**。
  // 2本入れると名前チップと重なり、ギフト名が省略記号で消える。
  const laneCards = cell.inline ? cards.slice(-1) : cards;

  const laneClass = [
    "replay-celllanes",
    cell.inline ? "replay-celllanes--inline" : "",
    cell.right ? "replay-celllanes--right" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cell.right ? "replay-cell replay-cell--right" : "replay-cell"}
      style={{ background: cellBackground(color) }}
    >
      <div className="replay-host">
        <div
          className="replay-ripple"
          style={{
            ["--fc" as string]: color,
            ["--replay-ripple" as string]: String(rippleScaleForCoins(peak)),
          }}
        >
          {Array.from({ length: ringCount }, (_, i) => (
            <span key={i} className="replay-ring" />
          ))}
          <div className={cell.largeAvatar ? "replay-avatar replay-avatar--lg" : "replay-avatar"}>
            {participant?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- 署名付きTikTok URL(数時間で失効)
              <img src={participant.avatarUrl} alt="" />
            ) : (
              initialOf(name)
            )}
          </div>
        </div>
        <div className="replay-host-score">{scoreNumber.toLocaleString("ja-JP")}</div>
      </div>
      {rank === null ? null : (
        <span className="replay-rank" style={{ background: color }}>
          {rank}位
        </span>
      )}
      <span className="replay-namechip">{name}</span>
      {isWinner ? (
        <span className="replay-win" style={{ background: GOLD }}>
          WIN
        </span>
      ) : null}
      {hideLanes ? null : (
        <div className={laneClass}>
          {laneCards.map((card) => (
            <ReplayGiftCard
              key={card.key}
              card={card}
              sender={senders[card.senderIndex]}
              gift={gifts[card.giftIndex]}
              color={color}
              mirror={cell.right}
              opponent={cell.opponentCard}
              elapsedMs={elapsedMs}
            />
          ))}
        </div>
      )}
    </div>
  );
}
