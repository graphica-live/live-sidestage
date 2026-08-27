import type { PublicMatchDetail } from "@/event/match-detail";
import { formatJstStamp } from "@/event/datetime";
import {
  MATCH_BATTLE_STATE_LABELS,
  MATCH_STATUS_LABELS,
  PUBLIC_REVIEW_REASON_LABELS,
  WIN_CONDITION_LABELS,
  WINNER_DECIDED_BY_LABELS,
} from "@/event/labels";
import { formatNumber } from "@/event/public-event";
import { CARD_CLIP, TAG_SKEW, TAG_UNSKEW } from "../battle-ui";
import { BattleCard } from "./BattleCard";

// 対戦詳細の表示部分。専用ページ([matchId]/page.tsx)とモーダル(MatchDetailModal.tsx)の
// 両方から使う共通コンポーネント。フックを持たないので client/server どちらの
// コンポーネントからでも import できる。バトルカード内部だけタップ操作(スマホでの
// 貢献者一覧切り替え)を持つので、そこだけ ./BattleCard に "use client" として分離してある。

/** タイトルから免責文までの本体。周りの入れ物(ページの戻るリンク、モーダルの閉じるボタン)は呼び出し側の責務。 */
export function MatchDetailBody({ detail }: { detail: PublicMatchDetail }) {
  return (
    <>
      <h1 className="flex items-center gap-2.5 font-[family-name:var(--font-battle)] text-2xl font-black tracking-tight text-white md:text-3xl">
        <span className="h-6 w-2 shrink-0 -skew-x-12 bg-brand" aria-hidden />
        {detail.placement ? `${detail.placement.rank}位決定戦` : detail.roundLabel}
      </h1>

      <MatchSummary detail={detail} />
      <MatchSides detail={detail} />

      <div className="mt-8">
        <div className="flex items-center gap-2.5">
          <span className="h-5 w-1.5 shrink-0 -skew-x-12 bg-brand" aria-hidden />
          <h2 className="text-sm font-bold tracking-wide text-white">バトル内訳</h2>
        </div>
        <BattleBreakdownSection detail={detail} />
      </div>

      <p className="mt-8 text-xs leading-relaxed text-gray-600">
        集計は当サービスが受信したギフトに基づく。通信状況により実際と差が出る場合がある。
        最終的な勝敗は実際のバトルスコアおよび運営判断で決定する。
      </p>
    </>
  );
}

function MatchSummary({ detail }: { detail: PublicMatchDetail }) {
  const decidedLabel = detail.winnerDecidedBy ? WINNER_DECIDED_BY_LABELS[detail.winnerDecidedBy] : null;
  const reviewLabel = detail.reviewReason ? PUBLIC_REVIEW_REASON_LABELS[detail.reviewReason] : null;

  return (
    <dl className={`mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border border-white/10 bg-panel p-4 text-sm sm:grid-cols-3 ${CARD_CLIP}`}>
      <Item label="開催日程">{detail.sessionLabel || "—"}</Item>
      <Item label="勝利条件">{WIN_CONDITION_LABELS[detail.winCondition]}</Item>
      <Item label="状態">{MATCH_STATUS_LABELS[detail.status] ?? detail.status}</Item>
      <Item label="決定方法">{decidedLabel ?? "未確定"}</Item>
      <Item label="決定時刻">{detail.decidedAt ? formatJstStamp(new Date(detail.decidedAt)) : "—"}</Item>
      <Item label="不戦勝">{detail.isBye ? "はい" : "いいえ"}</Item>
      {reviewLabel && (
        <div className="col-span-2 sm:col-span-3">
          <dt className="text-xs text-gray-500">運営確認</dt>
          <dd className="text-yellow-300">{reviewLabel}</dd>
        </div>
      )}
      {detail.hasFeederOverride && (
        <div className="col-span-2 sm:col-span-3">
          <dt className="text-xs text-gray-500">組み合わせ</dt>
          <dd className="text-amber-300">
            この枠は接続が変更されている。トーナメント表に描かれている接続線は実際のフローと異なる。
          </dd>
        </div>
      )}
    </dl>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-white">{children}</dd>
    </div>
  );
}

function MatchSides({ detail }: { detail: PublicMatchDetail }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
      {detail.sides.map((side) => (
        <div
          key={side.id}
          className={`min-w-0 border p-2.5 sm:p-3 ${CARD_CLIP} ${
            side.isWinner ? "border-brand/50 bg-brand/[0.06]" : "border-white/10 bg-panel"
          }`}
        >
          <div className="flex items-center gap-1.5 sm:gap-2">
            {side.entrants.slice(0, 4).map((e) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={e.participantId}
                src={`/api/public/avatar/${e.participantId}`}
                alt=""
                title={e.displayName}
                width={32}
                height={32}
                className="h-6 w-6 shrink-0 rounded-full border border-panel bg-white/5 object-cover sm:h-8 sm:w-8"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ))}
            <p className="min-w-0 flex-1 truncate text-xs font-medium sm:text-sm">{side.name ?? "未確定"}</p>
            {side.isWinner && (
              <span
                className={`shrink-0 border border-brand/50 bg-brand/10 px-1.5 py-0.5 text-[9px] font-bold text-brand sm:px-2 sm:text-[10px] ${TAG_SKEW}`}
              >
                <span className={`inline-block ${TAG_UNSKEW}`}>勝者</span>
              </span>
            )}
          </div>
          <p className="mt-2 truncate font-mono text-xs tabular-nums text-gray-300 sm:text-sm">
            {formatNumber(side.diamonds)}{" "}
            <span className="text-[10px] text-gray-500 sm:text-xs">ダイヤ(全バトル合計)</span>
          </p>
        </div>
      ))}
    </div>
  );
}

function BattleBreakdownSection({ detail }: { detail: PublicMatchDetail }) {
  if (detail.battleState !== "AVAILABLE") {
    return (
      <p className={`mt-4 border border-dashed border-white/15 p-4 text-sm text-gray-500 ${CARD_CLIP}`}>
        {MATCH_BATTLE_STATE_LABELS[detail.battleState]}
      </p>
    );
  }

  if (detail.battles.length === 0) {
    return (
      <p className={`mt-4 border border-dashed border-white/15 p-4 text-sm text-gray-500 ${CARD_CLIP}`}>
        まだバトルを検知できていない。
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {detail.battles.map((battle, i) => (
        <BattleCard key={battle.candidateId} battle={battle} index={i} sides={detail.sides} />
      ))}
    </div>
  );
}
