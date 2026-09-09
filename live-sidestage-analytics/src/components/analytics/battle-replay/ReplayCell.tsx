"use client";

import type { ReplayGift, ReplayParticipant, ReplaySender } from "@/lib/battle-replay-contract";
import { GOLD } from "../battle-colors";
import { initialOf, rippleScaleForCoins } from "./replay-format";
import { cellBackground } from "./replay-color";
import type { StageCell } from "./replay-layout";
import { BIG_GIFT_DURATION_MS, bigGiftTierOf, type ReplayCard } from "./replay-select";
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

/** バトル終了直後、中央へ大きく「WIN」を出してから常設バッジ位置へ移動・縮小する基準時間。
 * 実際の演出尺は `motionScale` で割って、再生速度に非依存にする(900ms/650ms は常に実時間)。
 */
const WIN_REVEAL_MS = 900;
const WIN_TRAVEL_MS = 650;

/**
 * 誰が勝ったか一目でわかるよう、終了の瞬間だけ大きく出す演出。**elapsedMs の純関数**
 * (一時停止・シークでも位置がそのまま出るように、CSS アニメではなく計算で出入りを作る)。
 * `sinceEndMs` は `elapsedMs - durationMs`。0 未満(まだ終わっていない)・
 * 総時間以上(移動完了、以後は常設の小バッジのみ)は null。
 *
 * `motionScale` は再生速度の逆数(4倍速なら 0.25)。WIN 演出の尺を速度非依存にするため、
 * `WIN_REVEAL_MS` と `WIN_TRAVEL_MS` をここで割る。これにより、実時間での演出長は常に一定。
 * (大ギフト演出 `bigGiftPhase()` とは逆方向のスケーリング)
 */
function winRevealPhase(
  sinceEndMs: number,
  cellRight: boolean,
  motionScale: number
): { opacity: number; scale: number; top: string; left: string } | null {
  const revealMs = WIN_REVEAL_MS / motionScale;
  const travelMs = WIN_TRAVEL_MS / motionScale;
  const totalMs = revealMs + travelMs;
  if (sinceEndMs < 0 || sinceEndMs >= totalMs) return null;
  if (sinceEndMs < revealMs) {
    const t = sinceEndMs / revealMs;
    return { opacity: t, scale: 0.4 + 0.6 * t, top: "50%", left: "50%" };
  }
  const t = (sinceEndMs - revealMs) / travelMs;
  const eased = t * t * (3 - 2 * t); // smoothstep
  return {
    opacity: 1,
    scale: 1 - 0.6 * eased,
    // 中央(50%,50%) → 常設バッジ位置へ寄せる。
    // cellRight=false(左側セル) なら常設位置は右上(right:7px, top:7px)
    // cellRight=true(右側セル) なら常設位置は左上(left:7px, top:7px)に移動させる
    top: `${50 - 43 * eased}%`,
    left: cellRight ? `${50 - 43 * eased}%` : `${50 + 43 * eased}%`,
  };
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
  durationMs,
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
  /** バトルの尺。WIN 演出(終了直後だけ大きく出す)の起点計算に使う。 */
  durationMs: number;
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
  const bigGiftTier = bigGift ? bigGiftTierOf(bigGift.diamonds) : null;
  const winReveal = isWinner ? winRevealPhase(elapsedMs - durationMs, cell.right, motionScale) : null;
  const battleEnded = elapsedMs >= durationMs;
  const cellClass = [
    "replay-cell",
    cell.right ? "replay-cell--right" : "",
    // 配信者アイコンを隠すのは枠いっぱいの `big` だけ。`mid` は枠の半分しか覆わない。
    bigGiftImg && bigGiftTier === "big" ? "replay-cell--biggift" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cellClass} style={{ background: cellBackground(color) }}>
      {bigGiftImg && bigGift ? (
        <div
          className={bigGiftTier === "mid" ? "replay-biggift replay-biggift--mid" : "replay-biggift"}
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
      {isWinner && battleEnded && !winReveal ? (
        <span className="replay-win" style={{ background: GOLD }}>
          WIN
        </span>
      ) : null}
      {winReveal ? (
        <span
          className="replay-win-big"
          style={{
            background: GOLD,
            opacity: winReveal.opacity,
            top: winReveal.top,
            left: winReveal.left,
            transform: `translate(-50%, -50%) scale(${winReveal.scale})`,
          }}
        >
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
