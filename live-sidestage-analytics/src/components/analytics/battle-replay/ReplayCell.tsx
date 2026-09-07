"use client";

import type { ReplayGift, ReplayParticipant, ReplaySender } from "@/lib/battle-replay-contract";
import { GOLD } from "../battle-colors";
import { initialOf, rippleScaleForCoins } from "./replay-format";
import { cellBackground } from "./replay-color";
import type { StageCell } from "./replay-layout";
import { BIG_GIFT_DURATION_MS, type ReplayCard } from "./replay-select";
import { ReplayGiftCard } from "./ReplayGiftCard";

/** 大ギフト演出の出入り。`0 → 0.12` で立ち上げ、`0.74 → 1` で伸びながら消える。 */
function bigGiftPhase(sinceMs: number): { opacity: number; transform: string } {
  const p = Math.max(0, Math.min(1, sinceMs / BIG_GIFT_DURATION_MS));
  if (p < 0.12) {
    const t = p / 0.12;
    return { opacity: t, transform: `scale(${0.74 + 0.26 * t})` };
  }
  if (p < 0.74) return { opacity: 1, transform: "scale(1)" };
  const t = (p - 0.74) / 0.26;
  return { opacity: 1 - t, transform: `scale(${1 + 0.07 * t})` };
}

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
  bigGift,
  motionScale,
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
  /** 枠いっぱいの大演出を出すギフト(`BIG_GIFT_MIN_DIAMONDS` 以上)。無ければ null。 */
  bigGift: ReplayCard | null;
  /** アニメーション尺の倍率。再生速度の逆数(4倍速なら 0.25)。 */
  motionScale: number;
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

  // ギフト画像が取れないときは大演出を出さない(配信者アイコンを隠すだけになるため)。
  const bigGiftImg = bigGift ? gifts[bigGift.giftIndex]?.img ?? null : null;
  const cellClass = [
    "replay-cell",
    cell.right ? "replay-cell--right" : "",
    bigGiftImg ? "replay-cell--biggift" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cellClass} style={{ background: cellBackground(color) }}>
      {bigGiftImg && bigGift ? (
        <div
          className="replay-biggift"
          // **出入りは CSS アニメではなく elapsedMs から計算する。** CSS の尺は実時間なので、
          // 一時停止・シーク中に走り切ってしまい、opacity 0 の演出が枠に残ったまま
          // 配信者アイコンだけ消えた状態になる(描画は elapsedMs の純関数、が全体の設計)。
          // 揺れだけは実時間の CSS アニメで、尺を再生速度で割って渡す。
          style={{
            ...bigGiftPhase(elapsedMs - bigGift.startMs),
            ["--bg-dur" as string]: `${Math.max(1, Math.round(BIG_GIFT_DURATION_MS * motionScale))}ms`,
          }}
          key={bigGift.key}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 署名付きTikTok URL(数時間で失効) */}
          <img src={bigGiftImg} alt="" />
        </div>
      ) : null}
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
