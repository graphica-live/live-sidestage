"use client";

import { ReplayItemCardType } from "@/lib/battle-replay-contract";
import { formatClock } from "./replay-format";
import { itemAppearT, type ReplayActiveItem } from "./replay-select";

function widthsOf(scores: number[]): number[] {
  const total = scores.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return scores.map(() => 100 / Math.max(1, scores.length));
  return scores.map((v) => (v / total) * 100);
}

type ItemKind = "glove" | "vault" | "hammer" | "top2" | "top3" | "unknown";

function kindOf(cardType: number): ItemKind {
  switch (cardType) {
    case ReplayItemCardType.GLOVE:
      return "glove";
    case ReplayItemCardType.VAULT_GLOVE:
      return "vault";
    case ReplayItemCardType.HAMMER:
      return "hammer";
    case ReplayItemCardType.TOP2_BOOSTER:
      return "top2";
    case ReplayItemCardType.TOP3_BOOSTER:
      return "top3";
    default:
      return "unknown";
  }
}

function labelOf(cardType: number): string {
  switch (kindOf(cardType)) {
    case "glove":
      return "ブースティンググローブ";
    case "vault":
      return "金グローブ";
    case "hammer":
      return "ハンマー";
    case "top2":
      return "2位ブースター";
    case "top3":
      return "3位ブースター";
    default:
      return "バトルアイテム";
  }
}

function ReplayItemChip({ item }: { item: ReplayActiveItem }) {
  const kind = kindOf(item.cardType);
  const glyph = kind === "glove" || kind === "vault" || kind === "hammer";
  return (
    <div
      className="replay-item"
      role="img"
      aria-label={`${labelOf(item.cardType)} 残り ${formatClock(item.remainMs)}`}
    >
      <span
        className={`replay-item-icon replay-item-icon--${kind}`}
        aria-hidden
        style={{ ["--replay-item-appear" as string]: String(itemAppearT(item.remainMs)) }}
      >
        {glyph ? <span className="replay-item-glyph" /> : kind === "top2" ? "×2" : kind === "top3" ? "×3" : "!"}
      </span>
      <span className="replay-item-time">{formatClock(item.remainMs)}</span>
    </div>
  );
}

export function ReplayScoreBar({
  scores,
  colors,
  elapsedMs,
  durationMs,
  transitionMs = 0,
  boosting = false,
  leftItems = [],
  rightItems = [],
}: {
  scores: string[];
  colors: string[];
  elapsedMs: number;
  durationMs: number;
  transitionMs?: number;
  boosting?: boolean;
  leftItems?: ReplayActiveItem[];
  rightItems?: ReplayActiveItem[];
}) {
  const numeric = scores.map((s) => {
    try {
      return Number(BigInt(s));
    } catch {
      return 0;
    }
  });
  const widths = widthsOf(numeric);
  return (
    <div className="replay-scorebar">
      {numeric.map((value, index) => (
        <div
          key={index}
          className={index === numeric.length - 1 ? "replay-seg replay-seg--right" : "replay-seg"}
          style={{
            background: colors[index],
            width: `${widths[index]}%`,
            transitionDuration: `${transitionMs}ms`,
          }}
        >
          {value.toLocaleString("ja-JP")}
        </div>
      ))}
      {leftItems.length > 0 ? (
        <div className="replay-items replay-items--left">
          {leftItems.map((item) => (
            <ReplayItemChip key={item.key} item={item} />
          ))}
        </div>
      ) : null}
      {rightItems.length > 0 ? (
        <div className="replay-items replay-items--right">
          {rightItems.map((item) => (
            <ReplayItemChip key={item.key} item={item} />
          ))}
        </div>
      ) : null}
      <div
        className={
          durationMs - elapsedMs <= 0
            ? "replay-clock replay-clock--ended"
            : boosting
              ? "replay-clock replay-clock--boost"
              : "replay-clock"
        }
      >
        {formatClock(Math.max(0, durationMs - elapsedMs))}
      </div>
    </div>
  );
}

