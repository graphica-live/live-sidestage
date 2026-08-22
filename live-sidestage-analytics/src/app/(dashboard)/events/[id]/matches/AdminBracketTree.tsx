import { MATCH_STATUS_CLASSES, MATCH_STATUS_LABELS } from "@/event/labels";
import type { MatchRow } from "./MatchManager";

// 管理画面のトーナメント表(表モード)。公開ページの BracketTree.tsx と
// **配置関係(決勝を中央に置いた再帰ツリー・接続線の引き方)を揃えている**
// — 幾何の成立条件(カード高さがすべて同じであること)も含めて同じ制約を持つ。
//
// 公開側との違いは2つだけ:
//   1. 閲覧専用データ(BracketMatchDto)ではなく管理用の MatchRow を使う
//   2. カードは操作ボタンを持たない代わりにクリックできる
//      (承認・勝者確定などの操作は呼び出し元がモーダルで開く MatchCard に任せる)
//
// 幾何を変えるときは src/event/CLAUDE.md の「公開トーナメント表の幾何を壊さない」を読むこと。

const CARD_W = "w-40 sm:w-44";
const CONN_W = "w-5";
const CARD_H = "h-24";

type MatchIndex = Map<string, MatchRow>;

function key(round: number, position: number): string {
  return `${round}:${position}`;
}

export function AdminBracketTree({
  matches,
  onSelect,
}: {
  matches: MatchRow[];
  onSelect: (matchId: string) => void;
}) {
  if (matches.length === 0) return null;

  const roundCount = Math.max(...matches.map((m) => m.round));
  const index: MatchIndex = new Map(matches.map((m) => [key(m.round, m.position), m]));
  const hasWings = roundCount >= 2;

  return (
    <div className="overflow-x-auto pb-2">
      <div className="min-w-max">
        <RoundHeadings roundCount={roundCount} index={index} hasWings={hasWings} />

        <div className="flex items-center pt-2">
          {hasWings && (
            <MatchNode
              round={roundCount - 1}
              position={0}
              mirror={false}
              index={index}
              onSelect={onSelect}
            />
          )}
          {hasWings && <StraightConnector />}

          <div className={`${CARD_W} shrink-0`}>
            <MatchCardOrEmpty match={index.get(key(roundCount, 0))} mirror={false} onSelect={onSelect} />
          </div>

          {hasWings && <StraightConnector />}
          {hasWings && (
            <MatchNode
              round={roundCount - 1}
              position={1}
              mirror
              index={index}
              onSelect={onSelect}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function RoundHeadings({
  roundCount,
  index,
  hasWings,
}: {
  roundCount: number;
  index: MatchIndex;
  hasWings: boolean;
}) {
  const label = (round: number) => index.get(key(round, 0))?.roundLabel ?? `${round}回戦`;
  const wings = Array.from({ length: roundCount - 1 }, (_, i) => i + 1);

  return (
    <div className="flex items-end">
      {hasWings &&
        wings.map((round) => (
          <div key={`l${round}`} className="flex">
            <div className={`${CARD_W} shrink-0 text-center text-xs text-gray-500`}>
              {label(round)}
            </div>
            <div className={`${CONN_W} shrink-0`} />
          </div>
        ))}

      <div className={`${CARD_W} shrink-0 text-center text-xs font-semibold text-gray-300`}>
        {label(roundCount)}
      </div>

      {hasWings &&
        [...wings].reverse().map((round) => (
          <div key={`r${round}`} className="flex">
            <div className={`${CONN_W} shrink-0`} />
            <div className={`${CARD_W} shrink-0 text-center text-xs text-gray-500`}>
              {label(round)}
            </div>
          </div>
        ))}
    </div>
  );
}

function MatchNode({
  round,
  position,
  mirror,
  index,
  onSelect,
}: {
  round: number;
  position: number;
  mirror: boolean;
  index: MatchIndex;
  onSelect: (matchId: string) => void;
}) {
  const card = (
    <div className={`${CARD_W} shrink-0`}>
      <MatchCardOrEmpty match={index.get(key(round, position))} mirror={mirror} onSelect={onSelect} />
    </div>
  );

  if (round <= 1) {
    return <div className="flex items-center">{card}</div>;
  }

  return (
    <div className={`flex items-stretch ${mirror ? "flex-row-reverse" : ""}`}>
      <div className="flex flex-col">
        <div className="flex flex-1 items-center py-1">
          <MatchNode round={round - 1} position={position * 2} mirror={mirror} index={index} onSelect={onSelect} />
        </div>
        <div className="flex flex-1 items-center py-1">
          <MatchNode
            round={round - 1}
            position={position * 2 + 1}
            mirror={mirror}
            index={index}
            onSelect={onSelect}
          />
        </div>
      </div>

      <PairConnector mirror={mirror} />

      <div className="flex items-center">{card}</div>
    </div>
  );
}

function PairConnector({ mirror }: { mirror: boolean }) {
  const fromChildren = mirror ? "right-0" : "left-0";
  const spine = mirror ? "right-1/2" : "left-1/2";
  return (
    <div className={`relative ${CONN_W} shrink-0 self-stretch`} aria-hidden>
      <span className={`absolute ${fromChildren} top-1/4 h-px w-1/2 bg-border`} />
      <span className={`absolute ${fromChildren} bottom-1/4 h-px w-1/2 bg-border`} />
      <span className={`absolute ${spine} bottom-1/4 top-1/4 w-px bg-border`} />
      <span className={`absolute ${spine} top-1/2 h-px w-1/2 bg-border`} />
    </div>
  );
}

function StraightConnector() {
  return (
    <div className={`relative ${CONN_W} shrink-0`} aria-hidden>
      <span className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
    </div>
  );
}

function MatchCardOrEmpty({
  match,
  mirror,
  onSelect,
}: {
  match: MatchRow | undefined;
  mirror: boolean;
  onSelect: (matchId: string) => void;
}) {
  if (!match) {
    return (
      <div
        className={`flex ${CARD_H} items-center justify-center rounded-xl border border-dashed border-border text-[10px] text-gray-600`}
      >
        —
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(match.id)}
      className={`card flex ${CARD_H} w-full flex-col justify-between overflow-hidden p-2 text-left transition hover:border-brand/40`}
    >
      <div
        className={`flex items-center justify-between gap-1 text-[10px] text-gray-500 ${
          mirror ? "flex-row-reverse" : ""
        }`}
      >
        <span
          className={`rounded-full px-1.5 py-0.5 ${
            MATCH_STATUS_CLASSES[match.status] ?? "bg-white/5 text-gray-400"
          }`}
        >
          {MATCH_STATUS_LABELS[match.status] ?? match.status}
        </span>
      </div>

      {match.sides.map((side) => (
        <div
          key={side.id}
          className={`flex items-center justify-between gap-1 rounded-lg px-1.5 py-1 text-sm ${
            match.winnerSideId === side.id ? "bg-brand/10 ring-1 ring-brand/40" : "bg-white/5"
          } ${mirror ? "flex-row-reverse" : ""}`}
        >
          <span className={`min-w-0 flex-1 truncate ${mirror ? "text-right" : ""}`}>
            {side.empty ? <span className="text-gray-600">未確定</span> : side.label}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-gray-400">
            {Number(side.diamonds).toLocaleString("ja-JP")}
          </span>
        </div>
      ))}
    </button>
  );
}
