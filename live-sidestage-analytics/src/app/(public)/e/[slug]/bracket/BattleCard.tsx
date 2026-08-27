"use client";

import { useState } from "react";
import type { BattleContributionSlot, BattleDetail, PublicMatchDetail } from "@/event/match-detail";
import { formatJstStamp } from "@/event/datetime";
import { formatNumber, formatPoints } from "@/event/public-event";
import { CARD_CLIP } from "../battle-ui";

// バトル内訳カード。スマホでは対戦相手2枚を横並びにしつつ、貢献者一覧までは
// 横に並べる余白が無いため、対戦相手カードをタップして選択中のサイドの貢献者一覧だけを
// 出すタブ切り替えにしてある(sm以上は両サイドを常に並べて表示)。この選択状態を
// 持つためだけにクライアントコンポーネントへ分離してある(match-detail-ui.tsx参照)。

export function BattleCard({
  battle,
  index,
  sides,
}: {
  battle: BattleDetail;
  index: number;
  sides: PublicMatchDetail["sides"];
}) {
  const sideName = (sideId: string) => sides.find((s) => s.id === sideId)?.name ?? "不明";
  const sideIndexOf = (sideId: string) => sides.find((s) => s.id === sideId)?.sideIndex ?? null;

  const battleSides = battle.sides ?? [];
  const [selectedSideIndex, setSelectedSideIndex] = useState<number | null>(
    battleSides.length > 0 ? sideIndexOf(battleSides[0].sideId) : null
  );

  return (
    <div className={`border border-white/10 bg-panel p-4 ${CARD_CLIP}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-white">第{index + 1}バトル</h3>
        <span className="text-xs text-gray-500">
          {formatJstStamp(new Date(battle.startedAt))}
          {battle.endedAt ? ` 〜 ${formatJstStamp(new Date(battle.endedAt))}` : "(進行中)"}
        </span>
      </div>

      {!battle.selected && (
        <p className="mt-1 text-xs text-gray-600">この候補は現在の結果には反映されていない(除外済み)。</p>
      )}

      {!battle.completed ? (
        <p className="mt-3 text-sm text-gray-500">まだ決着していない。</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {battleSides.map((s) => {
              const sideIndex = sideIndexOf(s.sideId);
              const isSelected = sideIndex !== null && sideIndex === selectedSideIndex;
              return (
                <button
                  key={s.sideId}
                  type="button"
                  onClick={() => sideIndex !== null && setSelectedSideIndex(sideIndex)}
                  aria-pressed={isSelected}
                  className={`min-w-0 border p-2.5 text-left sm:cursor-default ${CARD_CLIP} ${
                    battle.calculatedWinnerSideId === s.sideId
                      ? "border-brand/50 bg-brand/[0.06]"
                      : "border-white/10 bg-black/20"
                  } ${isSelected ? "ring-1 ring-inset ring-brand/60 sm:ring-0" : ""}`}
                >
                  <p className="truncate text-sm font-medium">{sideName(s.sideId)}</p>
                  <p className="font-mono text-sm tabular-nums text-gray-300">
                    {formatNumber(s.diamonds)} <span className="text-xs text-gray-500">ダイヤ</span>
                  </p>
                  {s.points !== s.diamonds && (
                    <p className="font-mono text-xs tabular-nums text-gray-500">{formatPoints(s.points)} pt</p>
                  )}
                  {battle.tiktokScores[s.sideId] && (
                    <p className="font-mono text-xs tabular-nums text-gray-500">
                      バトルスコア {formatNumber(battle.tiktokScores[s.sideId]!)}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          <BattleContributions battle={battle} sides={sides} selectedSideIndex={selectedSideIndex} />
        </>
      )}
    </div>
  );
}

/**
 * 貢献者一覧。**サイド(sideIndex)ごとに列を分けて左右に並べる。** 元は全員をひとつの
 * 縦リストに並べていたが、どちらの陣営への貢献かが一目で分からなかったため
 * (デザイン変更で追加)。スマホでは2列を並べる横幅が無いため、上の対戦相手カードで
 * 選んだ `selectedSideIndex` の列だけを表示するタブ切り替えにしてある(sm以上は両方表示)。
 */
function BattleContributions({
  battle,
  sides,
  selectedSideIndex,
}: {
  battle: BattleDetail;
  sides: PublicMatchDetail["sides"];
  selectedSideIndex: number | null;
}) {
  const contributions = battle.contributions;
  if (!contributions) return null;
  if (contributions.length === 0) {
    return <p className="mt-3 text-xs text-gray-600">このバトルで記録されたギフトはまだ無い。</p>;
  }

  const sideIndexes = [...new Set(contributions.map((c) => c.sideIndex))].sort((a, b) => a - b);
  const sideName = (sideIndex: number) =>
    sides.find((s) => s.sideIndex === sideIndex)?.name ?? `サイド${sideIndex + 1}`;

  return (
    <div className="mt-4 border-t border-white/5 pt-3">
      <p className="text-xs text-gray-500">
        貢献者一覧
        <span className="sm:hidden"> (上のカードをタップで切り替え)</span>
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {sideIndexes.map((sideIndex) => (
          <div
            key={sideIndex}
            className={`min-w-0 space-y-3 ${sideIndex === selectedSideIndex ? "" : "hidden sm:block"}`}
          >
            <p className="truncate text-xs font-semibold text-gray-400">{sideName(sideIndex)}</p>
            {contributions
              .filter((slot) => slot.sideIndex === sideIndex)
              .map((slot) => (
                <ContributionSlot key={slot.participantId} slot={slot} />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ContributionSlot({ slot }: { slot: BattleContributionSlot }) {
  return (
    <div>
      <p className="text-xs font-medium text-brand/80">
        {slot.displayName}
        <span className="ml-2 font-mono text-gray-500">
          {formatNumber(slot.diamonds)} ダイヤ ・ {formatNumber(String(slot.giftCount))} 個
        </span>
      </p>
      {slot.listeners.length === 0 ? (
        <p className="mt-1 text-xs text-gray-600">まだギフトが無い。</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {slot.listeners.map((l) => (
            <li key={l.uniqueId} className="flex items-center gap-2 text-xs text-gray-400">
              {l.profileImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={l.profileImageUrl}
                  alt=""
                  className="h-5 w-5 shrink-0 rounded-full object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="h-5 w-5 shrink-0 rounded-full bg-white/5" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">{l.nickname}</span>
              <span className="shrink-0 font-mono tabular-nums">{formatNumber(l.diamonds)}</span>
            </li>
          ))}
        </ul>
      )}
      {slot.truncated && <p className="mt-1 text-xs text-gray-600">上位のみ表示している。</p>}
    </div>
  );
}
