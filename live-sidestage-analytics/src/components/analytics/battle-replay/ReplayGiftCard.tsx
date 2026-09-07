"use client";

import type { ReplayGift, ReplaySender } from "@/lib/battle-replay-contract";
import { initialOf } from "./replay-format";
import { cardSizeOf, comboCountAt, type ReplayCard } from "./replay-select";
import { ReplayOdometer } from "./ReplayOdometer";

export function ReplayGiftCard({
  card,
  sender,
  gift,
  color,
  mirror,
  opponent,
  elapsedMs,
}: {
  card: ReplayCard;
  sender: ReplaySender | undefined;
  gift: ReplayGift | undefined;
  color: string;
  mirror: boolean;
  /** 相手陣営のカード。一回り小さく、リスナー名を出さない。 */
  opponent: boolean;
  elapsedMs: number;
}) {
  const size = cardSizeOf(card.diamonds);
  const count = comboCountAt(card, elapsedMs);
  const name = sender?.n ?? "";
  const className = [
    "replay-card",
    size === "sm" ? "replay-card--sm" : "",
    size === "lg" ? "replay-card--lg" : "",
    opponent ? "replay-card--op" : "",
    mirror ? "replay-card--mirror" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} style={{ ["--fc" as string]: color }}>
      <span className="replay-who">
        {sender?.a ? (
          // eslint-disable-next-line @next/next/no-img-element -- 署名付きTikTok URL(数時間で失効)。next/image の最適化は効かない
          <img src={sender.a} alt="" />
        ) : (
          initialOf(name)
        )}
      </span>
      <span className="replay-txt">
        <span className="replay-nm">{name}</span>
        <span className="replay-gf">{gift?.n ?? "ギフト"}</span>
      </span>
      {gift?.img ? (
        // eslint-disable-next-line @next/next/no-img-element -- 同上
        <img className="replay-thumb" src={gift.img} alt="" />
      ) : (
        <span className="replay-thumb" />
      )}
      <span className="replay-cnt">
        ×
        <ReplayOdometer value={count} total={card.count} />
      </span>
      {card.multiplierValue === 5 || card.multiplierValue === 6 ? (
        <span
          className={card.multiplierValue === 6 ? "replay-glove replay-glove--gold" : "replay-glove"}
          title={`グローブ ×${card.multiplierValue}`}
        />
      ) : null}
    </div>
  );
}
