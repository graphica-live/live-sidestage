"use client";

import { useCallback, useEffect, useState } from "react";
import { formatJstStamp } from "@/event/datetime";
import { FORMAT_PENDING_NOTES, STANDING_HEADINGS } from "@/event/labels";
import type {
  ContributionDto,
  EventSnapshot,
  LifeStandingDto,
  StandingDto,
} from "@/event/public-event";
import { formatNumber, formatPoints } from "@/event/public-event";
import type { EventFormat } from "@/event/validation";
import { CARD_CLIP, TAG_SKEW, TAG_UNSKEW } from "./battle-ui";

// 公開ページの結果表示。開催中だけポーリングして更新する。
// 集計ワーカーの間隔が10秒なので、それより短く引いても新しい値は出てこない。
const POLL_INTERVAL_MS = 10_000;

type Snapshot = EventSnapshot & { participantContributions: ContributionDto[] | null };

type Tab = "standings" | "listeners";

export function EventResults({
  slug,
  status,
  entryMode,
  format,
  initial,
}: {
  slug: string;
  status: string;
  entryMode: string;
  format: string;
  initial: Snapshot;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  const [tab, setTab] = useState<Tab>("standings");
  const [participantId, setParticipantId] = useState<string>("");
  const [sortBy, setSortBy] = useState<"points" | "diamonds">("points");

  const refresh = useCallback(async () => {
    const url = participantId
      ? `/api/public/events/${slug}/snapshot?participantId=${encodeURIComponent(participantId)}`
      : `/api/public/events/${slug}/snapshot`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return;
    setSnapshot(await res.json());
  }, [slug, participantId]);

  // 参加者を切り替えたときは即座に取り直す。
  useEffect(() => {
    if (participantId) void refresh();
  }, [participantId, refresh]);

  useEffect(() => {
    if (status !== "RUNNING") return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [status, refresh]);

  const listeners = participantId
    ? (snapshot.participantContributions ?? [])
    : snapshot.eventContributions;

  const sorted =
    sortBy === "diamonds"
      ? [...listeners].sort((a, b) => compareNumeric(b.diamonds, a.diamonds))
      : listeners;

  const notAggregated = snapshot.standings.length === 0 && snapshot.eventContributions.length === 0;

  // デスマッチの順位はライフで決まる。獲得ダイヤの順位表とは別のものを出す。
  const lives = format === "DEATHMATCH" ? snapshot.lives : null;
  const heading = lives ? "ライフ" : (STANDING_HEADINGS[format as EventFormat] ?? "順位");
  const pendingNote = FORMAT_PENDING_NOTES[format as EventFormat];

  return (
    <div className="mt-10">
      {pendingNote && (
        <p className={`mb-4 border border-yellow-400/25 bg-yellow-400/5 px-3 py-2 text-xs text-yellow-200/80 ${CARD_CLIP}`}>
          {pendingNote}
        </p>
      )}

      <div className="flex items-center gap-2.5">
        <span className="h-5 w-1.5 shrink-0 -skew-x-12 bg-brand" aria-hidden />
        <div className="flex gap-1 border-b border-white/10">
          <TabButton active={tab === "standings"} onClick={() => setTab("standings")}>
            {entryMode === "TEAM" ? `チーム${heading}` : `参加者${heading}`}
          </TabButton>
          <TabButton active={tab === "listeners"} onClick={() => setTab("listeners")}>
            リスナー貢献
          </TabButton>
        </div>
      </div>

      {notAggregated ? (
        <p className={`mt-4 border border-white/10 bg-white/[0.03] p-4 text-sm text-gray-500 ${CARD_CLIP}`}>
          {status === "SCHEDULED"
            ? "イベントが始まると、順位とリスナーの貢献ランキングがここに出る。"
            : "まだ集計されたギフトがない。"}
        </p>
      ) : tab === "standings" ? (
        lives ? (
          <LifeStandingsTable rows={lives} />
        ) : (
          <StandingsTable rows={snapshot.standings} hasMultiplier={snapshot.hasMultiplier} />
        )
      ) : (
        <div className="mt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select
              value={participantId}
              onChange={(e) => setParticipantId(e.target.value)}
              className="w-auto border border-white/10 bg-panel px-3 py-2 text-xs text-white focus:border-brand/60 focus:outline-none"
              aria-label="集計対象"
            >
              <option value="">イベント全体</option>
              {snapshot.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>

            {snapshot.hasMultiplier && (
              <div className="flex gap-1">
                <SortButton active={sortBy === "points"} onClick={() => setSortBy("points")}>
                  ポイント順
                </SortButton>
                <SortButton active={sortBy === "diamonds"} onClick={() => setSortBy("diamonds")}>
                  実弾(ダイヤ)順
                </SortButton>
              </div>
            )}
          </div>

          <ListenerTable rows={sorted} hasMultiplier={snapshot.hasMultiplier} />
        </div>
      )}

      {snapshot.lastAggregatedAt && (
        <p className="mt-3 text-xs text-gray-600">
          {/* toLocaleString はサーバー(UTC)とブラウザ(JST)で結果が変わり、
              SSR したこの行がハイドレーション不一致になる。JST 固定で出す。 */}
          最終集計: {formatJstStamp(new Date(snapshot.lastAggregatedAt))}
          {status === "RUNNING" && "(10秒ごとに更新)"}
        </p>
      )}
    </div>
  );
}

function compareNumeric(a: string, b: string): number {
  // BigInt 由来の文字列なので Number へ落とさずに比較する。
  const [ai, af = ""] = a.split(".");
  const [bi, bf = ""] = b.split(".");
  if (ai.length !== bi.length) return ai.length - bi.length;
  if (ai !== bi) return ai < bi ? -1 : 1;
  return af === bf ? 0 : af < bf ? -1 : 1;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-brand text-white"
          : "border-transparent text-gray-500 hover:text-gray-300"
      }`}
    >
      {children}
    </button>
  );
}

function SortButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`${TAG_SKEW} border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        active ? "border-brand/50 bg-brand/10 text-brand" : "border-white/10 text-gray-500 hover:text-gray-300"
      }`}
    >
      <span className={`inline-block ${TAG_UNSKEW}`}>{children}</span>
    </button>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const medal =
    rank === 1
      ? "border-yellow-400/60 bg-yellow-400/15 text-yellow-300"
      : rank === 2
        ? "border-gray-300/50 bg-gray-300/15 text-gray-200"
        : rank === 3
          ? "border-orange-400/50 bg-orange-400/15 text-orange-300"
          : "border-white/10 text-gray-500";
  return (
    <span
      className={`flex h-8 w-8 shrink-0 -skew-x-12 items-center justify-center border font-mono text-xs font-black tabular-nums ${medal}`}
    >
      <span className={`inline-block ${TAG_UNSKEW}`}>{rank}</span>
    </span>
  );
}

function StandingsTable({ rows, hasMultiplier }: { rows: StandingDto[]; hasMultiplier: boolean }) {
  if (rows.length === 0) {
    return <p className={`mt-4 border border-white/10 bg-white/[0.03] p-4 text-sm text-gray-500 ${CARD_CLIP}`}>まだ順位がついていない。</p>;
  }

  return (
    <ul className="mt-4 space-y-2">
      {rows.map((r) => (
        <li
          key={r.subjectId}
          className={`flex items-center gap-3 border p-3 ${CARD_CLIP} ${
            r.rank === 1 ? "border-brand/40 bg-brand/[0.06]" : "border-white/10 bg-panel"
          }`}
        >
          <RankBadge rank={r.rank} />
          {r.colorHex && (
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: r.colorHex }}
              aria-hidden
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{r.name}</p>
            {r.sub && <p className="truncate font-mono text-xs text-gray-500">{r.sub}</p>}
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-sm tabular-nums">
              {hasMultiplier ? formatPoints(r.points) : formatNumber(r.diamonds)}
              <span className="ml-1 text-xs text-gray-500">
                {hasMultiplier ? "pt" : "ダイヤ"}
              </span>
            </p>
            {hasMultiplier && (
              <p className="font-mono text-xs text-gray-600 tabular-nums">
                実弾 {formatNumber(r.diamonds)}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * デスマッチの順位表。残ライフが多い順(同じなら遅く脱落した順 → 獲得ダイヤ順)。
 * 獲得ダイヤの順位(StandingsTable)とは別物なので、混ぜて表示しない。
 */
function LifeStandingsTable({ rows }: { rows: LifeStandingDto[] }) {
  if (rows.length === 0) {
    return <p className={`mt-4 border border-white/10 bg-white/[0.03] p-4 text-sm text-gray-500 ${CARD_CLIP}`}>まだ順位がついていない。</p>;
  }

  return (
    <ul className="mt-4 space-y-2">
      {rows.map((r) => (
        <li
          key={r.subjectId}
          className={`flex items-center gap-3 border border-white/10 bg-panel p-3 ${CARD_CLIP} ${r.eliminated ? "opacity-50" : ""}`}
        >
          <RankBadge rank={r.rank} />
          {r.colorHex && (
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: r.colorHex }}
              aria-hidden
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{r.name}</p>
            {r.sub && <p className="truncate font-mono text-xs text-gray-500">{r.sub}</p>}
          </div>
          <div className="shrink-0 text-right">
            {r.eliminated ? (
              <p className="text-sm text-gray-500">脱落</p>
            ) : (
              <p className="text-sm text-brand" aria-label={`残ライフ ${r.current}`}>
                {"♥".repeat(Math.min(r.current, 10))}
                <span className="ml-1.5 font-mono text-xs text-gray-400 tabular-nums">
                  {r.current} / {r.max}
                </span>
              </p>
            )}
            <p className="font-mono text-xs text-gray-600 tabular-nums">
              {formatNumber(r.diamonds)} ダイヤ
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ListenerTable({
  rows,
  hasMultiplier,
}: {
  rows: ContributionDto[];
  hasMultiplier: boolean;
}) {
  if (rows.length === 0) {
    return <p className={`border border-white/10 bg-white/[0.03] p-4 text-sm text-gray-500 ${CARD_CLIP}`}>まだギフトが記録されていない。</p>;
  }

  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.listenerUniqueId} className={`border border-white/10 bg-panel p-3 ${CARD_CLIP}`}>
          <div className="flex items-center gap-3">
            <RankBadge rank={i + 1} />
            {r.profileImageUrl ? (
              // 外部(TikTok CDN)の画像なので next/image の最適化は通さない。
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.profileImageUrl}
                alt=""
                className="h-8 w-8 shrink-0 rounded-full object-cover"
                loading="lazy"
              />
            ) : (
              <span className="h-8 w-8 shrink-0 rounded-full bg-white/5" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{r.nickname}</p>
              <p className="truncate font-mono text-xs text-gray-500">@{r.listenerUniqueId}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-sm tabular-nums">
                {hasMultiplier ? formatPoints(r.points) : formatNumber(r.diamonds)}
                <span className="ml-1 text-xs text-gray-500">
                  {hasMultiplier ? "pt" : "ダイヤ"}
                </span>
              </p>
              <p className="font-mono text-xs text-gray-600 tabular-nums">
                {hasMultiplier && `実弾 ${formatNumber(r.diamonds)} ・ `}
                {formatNumber(String(r.giftCount))} 個
              </p>
            </div>
          </div>
          {/* 支援先。イベント全体の表示でだけ入る(参加者を選んでいるときは自明なので出ない)。
              判定はポイント基準なので、実弾(ダイヤ)順に並べ替えても所属は動かない。
              名前が長いとモバイルで切れるので、上の行の中ではなくカード幅いっぱいに置く。 */}
          {r.topParticipantName && (
            <p className="mt-2 truncate border-t border-white/5 pt-2 text-xs text-gray-500">
              <span className="text-brand/80">{r.topParticipantName}</span> のリスナー
              {r.participantCount > 1 && <>（他{r.participantCount - 1}人にも）</>}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
