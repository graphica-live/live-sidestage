import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findPublicEvent } from "@/event/public-event";
import { matchDetailCache, type BattleDetail, type PublicMatchDetail } from "@/event/match-detail";
import { formatJstStamp } from "@/event/datetime";
import {
  MATCH_BATTLE_STATE_LABELS,
  MATCH_STATUS_LABELS,
  PUBLIC_REVIEW_REASON_LABELS,
  WIN_CONDITION_LABELS,
  WINNER_DECIDED_BY_LABELS,
} from "@/event/labels";
import { formatNumber, formatPoints } from "@/event/public-event";
import { CARD_CLIP, TAG_SKEW, TAG_UNSKEW } from "../../battle-ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { slug: string; matchId: string };
}): Promise<Metadata> {
  const session = await getServerSession(authOptions);
  const event = await findPublicEvent(params.slug, session?.user?.id);
  if (!event || event.format !== "TOURNAMENT") return { title: "見つかりません" };
  return {
    title: `対戦詳細 — ${event.title}`,
    robots: event.visibility === "PUBLIC" ? undefined : { index: false, follow: false },
  };
}

export default async function MatchDetailPage({
  params,
}: {
  params: { slug: string; matchId: string };
}) {
  const session = await getServerSession(authOptions);
  const event = await findPublicEvent(params.slug, session?.user?.id);
  if (!event || event.format !== "TOURNAMENT") notFound();

  const detail = await matchDetailCache.load(prisma, {
    event,
    matchId: params.matchId,
    now: new Date(),
  });
  if (!detail) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href={`/e/${event.slug}/bracket`}
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-brand"
      >
        ← トーナメント表
      </Link>

      <h1 className="mt-3 flex items-center gap-2.5 font-[family-name:var(--font-battle)] text-2xl font-black tracking-tight text-white md:text-3xl">
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
    </div>
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
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {detail.sides.map((side) => (
        <div
          key={side.id}
          className={`border p-3 ${CARD_CLIP} ${
            side.isWinner ? "border-brand/50 bg-brand/[0.06]" : "border-white/10 bg-panel"
          }`}
        >
          <div className="flex items-center gap-2">
            {side.entrants.slice(0, 4).map((e) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={e.participantId}
                src={`/api/public/avatar/${e.participantId}`}
                alt=""
                title={e.displayName}
                width={32}
                height={32}
                className="h-8 w-8 shrink-0 rounded-full border border-panel bg-white/5 object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ))}
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{side.name ?? "未確定"}</p>
            {side.isWinner && (
              <span
                className={`shrink-0 border border-brand/50 bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand ${TAG_SKEW}`}
              >
                <span className={`inline-block ${TAG_UNSKEW}`}>勝者</span>
              </span>
            )}
          </div>
          <p className="mt-2 font-mono text-sm tabular-nums text-gray-300">
            {formatNumber(side.diamonds)} <span className="text-xs text-gray-500">ダイヤ(全バトル合計)</span>
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

function BattleCard({
  battle,
  index,
  sides,
}: {
  battle: BattleDetail;
  index: number;
  sides: PublicMatchDetail["sides"];
}) {
  const sideName = (sideId: string) => sides.find((s) => s.id === sideId)?.name ?? "不明";

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
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(battle.sides ?? []).map((s) => (
              <div
                key={s.sideId}
                className={`border p-2.5 ${CARD_CLIP} ${
                  battle.calculatedWinnerSideId === s.sideId
                    ? "border-brand/50 bg-brand/[0.06]"
                    : "border-white/10 bg-black/20"
                }`}
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
              </div>
            ))}
          </div>

          <BattleContributions battle={battle} />
        </>
      )}
    </div>
  );
}

function BattleContributions({ battle }: { battle: BattleDetail }) {
  const contributions = battle.contributions;
  if (!contributions) return null;
  if (contributions.length === 0) {
    return <p className="mt-3 text-xs text-gray-600">このバトルで記録されたギフトはまだ無い。</p>;
  }

  return (
    <div className="mt-4 space-y-3 border-t border-white/5 pt-3">
      <p className="text-xs text-gray-500">貢献者一覧</p>
      {contributions.map((slot) => (
        <div key={slot.participantId}>
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
      ))}
    </div>
  );
}
